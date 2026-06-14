import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Inbound email intake: an exporter auto-forwards a buyer's PO to their secret
// address po-<token>@in.theqra.com; Resend posts an "email.received" webhook;
// we match the exporter by the token, pull the PDF, and run the same pipeline as
// the WhatsApp path. The secret address is the auth (no inbox access, no OAuth).

const INBOUND_DOMAIN = "in.theqra.com";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

type InboundMediaType = "application/pdf" | "image/jpeg" | "image/png";

export function inboundAddressFor(token: string): string {
  return `po-${token}@${INBOUND_DOMAIN}`;
}

function shipmentRef(): string {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `SHP-${yyyymmdd}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

// The exporter's secret PO address, generated once and stored on the customer.
export async function getOrCreateInboundToken(customerId: string): Promise<string | null> {
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("customers")
    .select("inbound_token")
    .eq("id", customerId)
    .maybeSingle();
  if (data?.inbound_token) return data.inbound_token as string;

  const token = randomBytes(12).toString("hex"); // 96-bit, email-safe
  const { error } = await admin
    .from("customers")
    .update({ inbound_token: token })
    .eq("id", customerId)
    .is("inbound_token", null);
  if (error) {
    console.error("inbound_token_set_failed", { code: error.code });
    const { data: again } = await admin
      .from("customers")
      .select("inbound_token")
      .eq("id", customerId)
      .maybeSingle();
    return (again?.inbound_token as string) ?? null;
  }
  return token;
}

// Match a forwarded PO to its exporter from the recipient addresses.
export async function resolveCustomerByInbound(toList: string[]): Promise<string | null> {
  // Token is randomBytes(12) = 24 hex chars; the {16,64} bound below must move
  // with it if the token length ever changes, or matching silently breaks.
  const tokens: string[] = [];
  for (const addr of toList) {
    const m = (addr ?? "").toLowerCase().match(/po-([a-f0-9]{16,64})@in\.theqra\.com/);
    if (m) tokens.push(m[1]);
  }
  if (tokens.length === 0) return null;
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("customers")
    .select("id")
    .in("inbound_token", tokens)
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

// Manual Svix verification — no SDK dependency (consistent with our fetch-based
// Resend usage). Verifies HMAC over "{id}.{timestamp}.{body}" and rejects stale
// timestamps (replay guard).
export function verifyResendSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null }
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  const ts = parseInt(headers.timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest("base64");
  const expBuf = Buffer.from(expected);

  return headers.signature.split(" ").some((part) => {
    const sig = part.split(",")[1];
    if (!sig) return false;
    const sBuf = Buffer.from(sig);
    return sBuf.length === expBuf.length && timingSafeEqual(sBuf, expBuf);
  });
}

type AttachmentMeta = { download_url?: string; content_type?: string; size?: number; filename?: string };

// Pull the first usable PO attachment (PDF, else image) for a received email.
export async function fetchInboundAttachment(
  emailId: string
): Promise<{ base64: string; mediaType: InboundMediaType; bytes: Buffer; contentType: string } | null> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;

  let listRes: Response;
  try {
    listRes = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
  } catch (e) {
    console.error("inbound_attachment_list_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
  if (!listRes.ok) {
    console.error("inbound_attachment_list_status", listRes.status);
    return null;
  }

  const listJson = (await listRes.json().catch(() => null)) as { data?: AttachmentMeta[] } | null;
  const atts = listJson?.data ?? [];
  const pick =
    atts.find((a) => (a.content_type ?? "").includes("pdf")) ??
    atts.find((a) => (a.content_type ?? "").startsWith("image/"));
  if (!pick?.download_url) return null;
  if (typeof pick.size === "number" && pick.size > MAX_FILE_SIZE_BYTES) {
    console.error("inbound_attachment_too_large", { size: pick.size });
    return null;
  }

  let dlRes: Response;
  try {
    dlRes = await fetch(pick.download_url);
  } catch (e) {
    console.error("inbound_attachment_dl_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
  if (!dlRes.ok) {
    console.error("inbound_attachment_dl_status", dlRes.status);
    return null;
  }
  const arr = await dlRes.arrayBuffer();
  if (arr.byteLength > MAX_FILE_SIZE_BYTES) {
    console.error("inbound_attachment_too_large_bytes", { size: arr.byteLength });
    return null;
  }

  const bytes = Buffer.from(arr);
  const ct = (pick.content_type ?? "application/pdf").toLowerCase();
  const mediaType: InboundMediaType = ct.includes("pdf")
    ? "application/pdf"
    : ct.includes("png")
      ? "image/png"
      : "image/jpeg";
  return { base64: bytes.toString("base64"), mediaType, bytes, contentType: ct };
}

// Create the shipment, store the PO, and audit it (source = email). Mirrors the
// WhatsApp path's creation. Dedups on Resend's email id (retry-safe) and, if the
// file can't be stored, removes the empty shipment so the pipeline never runs on
// nothing. Returns the shipment id + whether it was a duplicate.
export async function ingestEmailPo(
  customerId: string,
  file: { bytes: Buffer; contentType: string },
  subject: string,
  emailId: string
): Promise<{ shipmentId: string; duplicate: boolean } | null> {
  const admin = createSupabaseServerClient();

  // Resend retries the same delivery with the same email id — reuse, don't dup.
  const { data: prior } = await admin
    .from("shipments")
    .select("id")
    .eq("inbound_email_id", emailId)
    .limit(1)
    .maybeSingle();
  if (prior?.id) return { shipmentId: prior.id as string, duplicate: true };

  const { data: shipment, error } = await admin
    .from("shipments")
    .insert({
      customer_id: customerId,
      reference_number: shipmentRef(),
      customer_po_number: subject.slice(0, 100) || null,
      status: "po_received",
      inbound_email_id: emailId,
    })
    .select("id")
    .single();
  if (error || !shipment) {
    console.error("email_shipment_create_failed", { code: error?.code });
    return null;
  }
  const shipmentId = shipment.id as string;

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const ext = file.contentType.includes("pdf") ? "pdf" : file.contentType.includes("png") ? "png" : "jpg";
  const storagePath = `${customerId}/${shipmentId}/${sha256.slice(0, 16)}.${ext}`;

  const { error: upErr } = await admin.storage
    .from("purchase-orders")
    .upload(storagePath, file.bytes, { contentType: file.contentType, upsert: false });
  if (upErr) {
    // No PO stored → remove the empty shipment so nothing runs on a missing file.
    console.error("email_po_upload_failed", { name: upErr.name });
    await admin.from("shipments").delete().eq("id", shipmentId);
    return null;
  }

  const { error: auditErr } = await admin.from("audit_po_ingest").insert({
    customer_id: customerId,
    shipment_id: shipmentId,
    storage_path: storagePath,
    file_sha256: sha256,
    source: "email",
  });
  if (auditErr) console.error("email_audit_log_failed", { code: auditErr.code });

  return { shipmentId, duplicate: false };
}

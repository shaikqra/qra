import { NextRequest, after } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import twilio from "twilio";
import { createHash, randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hashPhone } from "@/lib/hash";
import { runAutoPipeline } from "@/lib/docs/auto-pipeline";
import {
  extractPoFields,
  extractPoFieldsFromText,
  type SupportedMediaType,
} from "@/lib/ai/extract-po";
import { isOrderMessage } from "@/lib/ai/classify-order";
import { missingRequiredFields } from "@/lib/docs/required-fields";
import { missingFieldLines, isValueConfirmation } from "@/lib/docs/gap-message";
import { computeProposedValue } from "@/lib/docs/compute-value";
import { validateExtracted, lowConfidenceFields } from "@/lib/docs/validate";
import { screenShipmentParties, partiesFromExtracted } from "@/lib/screening/screen-shipment";
import { parseGapReply } from "@/lib/ai/parse-gap-reply";
import {
  generateCommercialInvoiceCore,
  generatePackingListCore,
} from "@/lib/docs/generate";
import { sendDocsToCustomerCore } from "@/lib/docs/send-to-customer";
import { sendDocsToChaCore } from "@/lib/docs/send-to-cha-core";
import { isAutoSendChaEnabled } from "@/lib/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The auto-pipeline (AI extraction + doc generation) keeps running after the
// webhook reply is sent; give the function room to finish.
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Qra, a helpful AI assistant for Indian exporters. Respond briefly and helpfully in 1-3
   sentences.`;

const MAX_INPUT_LENGTH = 1000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateLimitBuckets = new Map<string, number[]>();

function isRateLimited(sender: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitBuckets.get(sender) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitBuckets.set(sender, timestamps);
    return true;
  }
  timestamps.push(now);
  rateLimitBuckets.set(sender, timestamps);
  return false;
}

function twimlResponse(message: string): Response {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

async function getOrCreateCustomer(
  phoneHash: string,
  whatsappNumber: string,
  profileName: string
): Promise<string | null> {
  try {
    const supabase = createSupabaseServerClient();
    const name = profileName.trim().slice(0, 120) || null;
    const { data: existing } = await supabase
      .from("customers")
      .select("id, whatsapp_number, display_name")
      .eq("phone_hash", phoneHash)
      .maybeSingle();
    if (existing) {
      // Backfill number/name for customers created before we stored them.
      // Never overwrite a display_name — the operator may have set it.
      const patch: Record<string, string> = {};
      if (!existing.whatsapp_number) patch.whatsapp_number = whatsappNumber;
      if (!existing.display_name && name) patch.display_name = name;
      if (Object.keys(patch).length > 0) {
        await supabase.from("customers").update(patch).eq("id", existing.id);
      }
      return existing.id as string;
    }
    const { data: inserted, error } = await supabase
      .from("customers")
      .insert({ phone_hash: phoneHash, whatsapp_number: whatsappNumber, display_name: name })
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("customer_create_failed", { code: error?.code, message: error?.message });
      return null;
    }
    return inserted.id as string;
  } catch (err) {
    console.error("customer_lookup_exception", {
      name: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

function generateShipmentReference(): string {
  const today = new Date();
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `SHP-${yyyymmdd}-${suffix}`;
}

async function downloadTwilioMedia(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const envSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) {
    console.error("media_download_failed", { stage: "env_missing", hasToken: false });
    return null;
  }
  const sidMatch = url.match(/\/Accounts\/(AC[0-9a-fA-F]{32})\//);
  const urlSid = sidMatch?.[1];
  const sid = urlSid ?? envSid;
  if (!sid) {
    console.error("media_download_failed", { stage: "no_sid_available", hasEnvSid: !!envSid, hasUrlSid: false });
    return null;
  }
  if (envSid && urlSid && envSid !== urlSid) {
    console.warn("media_sid_mismatch", {
      envSidPrefix: envSid.slice(0, 8),
      urlSidPrefix: urlSid.slice(0, 8),
    });
  }
  const authHeader = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  try {
    console.log("media_download_start", {
      urlPrefix: url.slice(0, 120),
      sidSource: urlSid ? "url" : "env",
      sidPrefix: sid.slice(0, 8),
    });
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    console.log("media_download_response", { status: res.status, ok: res.ok, contentType:
  res.headers.get("content-type") });
    if (!res.ok) {
      console.error("media_download_failed", { stage: "http_not_ok", status: res.status, statusText: res.statusText
  });
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const arrayBuffer = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    console.log("media_download_bytes", { length: bytes.length });
    if (bytes.length > MAX_FILE_SIZE_BYTES) {
      console.error("media_download_failed", { stage: "too_large", length: bytes.length });
      return null;
    }
    if (bytes.length === 0) {
      console.error("media_download_failed", { stage: "empty_response" });
      return null;
    }
    return { bytes, contentType };
  } catch (err) {
    console.error("media_download_exception", {
      name: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

function extensionFromContentType(ct: string): string {
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("ogg") || ct.includes("opus")) return "ogg";
  if (ct.includes("mp3") || ct.includes("mpeg")) return "mp3";
  return "bin";
}

type POSubmissionResult =
  | { duplicate: true; shipmentRef: string }
  | {
      duplicate: false;
      shipmentRef: string;
      fileCount: number;
      shipmentId: string;
      firstReadable: { base64: string; mediaType: SupportedMediaType } | null;
    };

async function handlePOSubmission({
  customerId,
  mediaUrls,
  messageBody,
}: {
  customerId: string;
  mediaUrls: string[];
  messageBody: string;
}): Promise<POSubmissionResult | null> {
  const supabase = createSupabaseServerClient();
  console.log("po_submission_start", { customerId, mediaUrlCount: mediaUrls.length });

  // Download every attachment up front (usually one) and fingerprint each.
  const downloaded: { bytes: Buffer; contentType: string; sha256: string }[] = [];
  for (const url of mediaUrls) {
    if (!url) continue;
    const media = await downloadTwilioMedia(url);
    if (!media) continue;
    downloaded.push({
      bytes: media.bytes,
      contentType: media.contentType,
      sha256: createHash("sha256").update(media.bytes).digest("hex"),
    });
  }

  // Dedup ONLY a single-file message whose fingerprint matches one this
  // customer sent in the last 90 seconds — that's a Twilio retry or an
  // accidental double-tap, not a deliberate re-order. We deliberately do NOT
  // dedup multi-file messages (a corrected page would be lost) or anything
  // older (a genuine repeat order of the same goods must create a new shipment).
  if (downloaded.length === 1) {
    const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
    const { data: prior } = await supabase
      .from("audit_po_ingest")
      .select("shipment_id")
      .eq("customer_id", customerId)
      .eq("file_sha256", downloaded[0].sha256)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior) {
      const { data: existing } = await supabase
        .from("shipments")
        .select("reference_number")
        .eq("id", prior.shipment_id as string)
        .maybeSingle();
      if (existing) {
        console.log("po_submission_duplicate", { shipmentId: prior.shipment_id });
        return { duplicate: true, shipmentRef: existing.reference_number as string };
      }
    }
  }

  const shipmentRef = generateShipmentReference();
  const { data: shipment, error: shipErr } = await supabase
    .from("shipments")
    .insert({
      customer_id: customerId,
      reference_number: shipmentRef,
      customer_po_number: messageBody.slice(0, 100) || null,
      status: "po_received",
    })
    .select("id")
    .single();

  if (shipErr || !shipment) {
    console.error("shipment_create_failed", { code: shipErr?.code, message: shipErr?.message });
    return null;
  }

  const shipmentId = shipment.id as string;
  console.log("shipment_created", { shipmentId, shipmentRef });
  let storedCount = 0;
  let firstReadable: { base64: string; mediaType: SupportedMediaType } | null = null;

  for (let i = 0; i < downloaded.length; i++) {
    const media = downloaded[i];
    const ext = extensionFromContentType(media.contentType);
    const storagePath = `${customerId}/${shipmentId}/${media.sha256.slice(0, 16)}-${i}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("purchase-orders")
      .upload(storagePath, media.bytes, { contentType: media.contentType, upsert: false });

    if (uploadErr) {
      console.error("storage_upload_failed", { name: uploadErr.name, message: uploadErr.message });
      continue;
    }

    const { error: auditErr } = await supabase.from("audit_po_ingest").insert({
      customer_id: customerId,
      shipment_id: shipmentId,
      storage_path: storagePath,
      file_sha256: media.sha256,
      source: "whatsapp",
    });
    if (auditErr) {
      console.error("audit_log_failed", { code: auditErr.code, message: auditErr.message });
    }

    storedCount++;

    // Remember the first AI-readable file for the auto-pipeline.
    if (!firstReadable) {
      const mediaType: SupportedMediaType | null =
        ext === "pdf" ? "application/pdf"
        : ext === "jpg" ? "image/jpeg"
        : ext === "png" ? "image/png"
        : null;
      if (mediaType) {
        firstReadable = { base64: media.bytes.toString("base64"), mediaType };
      }
    }
  }

  console.log("po_submission_complete", { storedCount, totalUrls: mediaUrls.length });
  return { duplicate: false, shipmentRef, fileCount: storedCount, shipmentId, firstReadable };
}

// Short affirmations that count as a clear "yes, approved". We deliberately
// require the WHOLE message to be one of these, so "yes but change the price"
// is treated as a change request, not an approval.
const APPROVAL_PHRASES = new Set([
  "approve", "approved", "approve it", "approve them",
  "yes", "yes approve", "yes approved", "yep", "yeah",
  "ok", "okay", "confirm", "confirmed", "accept", "accepted",
  "looks good", "lgtm", "go ahead", "all good",
]);

function isApprovalMessage(body: string): boolean {
  const norm = body
    .toLowerCase()
    .replace(/[^a-z\s]/g, "") // drop emoji/punctuation so "APPROVE ✅" -> "approve"
    .replace(/\s+/g, " ")
    .trim();
  return APPROVAL_PHRASES.has(norm);
}

// If this customer has a shipment waiting on their approval, their text is an
// approve/change decision — not a general chat message. Returns a reply string
// when it handled the message, or null if nothing is pending (so the caller
// falls through to normal chat). Never logs the message body (may contain PII).
async function handleApprovalReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, reference_number, status")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_customer_approval")
    // Order by reference_number (SHP-YYYYMMDD-xxxx) — a column we know exists.
    // Newest reference sorts first; normally there's only one pending anyway.
    .order("reference_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shipment) return null;

  const shipmentId = shipment.id as string;
  const ref = shipment.reference_number as string;
  const message = body.slice(0, 500); // cap stored text

  if (isApprovalMessage(body)) {
    // Record approval on the documents — the schema's designated slot. The
    // immutability trigger allows only approved_at / approval_message to change.
    const { data: updated, error: updErr } = await supabase
      .from("generated_documents")
      .update({ approved_at: new Date().toISOString(), approval_message: message })
      .eq("shipment_id", shipmentId)
      .is("approved_at", null)
      .select("id");
    const approvedCount = updated?.length ?? 0;

    // Never tell the customer "approved & locked" unless documents were actually
    // stamped. On error or an empty set, leave status unchanged so it can retry.
    if (updErr || approvedCount === 0) {
      console.error("customer_approval_not_recorded", {
        shipmentId,
        hasError: !!updErr,
        approvedCount,
      });
      return `Thanks! We're just finalizing the documents for ${ref} — give us a moment and we'll confirm shortly.`;
    }

    // Move the shipment to 'customer_approved' so the board reflects it.
    // Guarded on the current status so a stale/duplicate reply can't clobber it.
    await supabase
      .from("shipments")
      .update({ status: "customer_approved" })
      .eq("id", shipmentId)
      .eq("status", "awaiting_customer_approval");

    await supabase.from("audit_operator_action").insert({
      operator_id: null, // customer acted, not an operator
      shipment_id: shipmentId,
      action_type: "approve",
      old_value: { status: shipment.status },
      new_value: {
        approved_by: "customer",
        approval_message: message,
        documents_approved: approvedCount,
        status_changed_to: "customer_approved",
      },
    });

    console.log("customer_approval_recorded", { shipmentId, approvedCount });

    // Agentic handoff: the customer's approval authorises sending the set to
    // their customs broker. Done in the background so the reply is instant; if
    // no CHA email is set (or the send fails) the shipment stays at
    // customer_approved for the operator to handle. The CHA is the next gate.
    after(async () => {
      try {
        // Pilot mode (default): the operator reviews and sends to the CHA.
        // Auto mode (operator-enabled in Settings): hand off automatically.
        if (!(await isAutoSendChaEnabled())) return;
        // requireStatus claims customer_approved -> filed_with_cha so the CHA
        // is emailed exactly once even on a retry.
        const sent = await sendDocsToChaCore(shipmentId, null, "customer_approved");
        const benign = sent.ok || ["no_cha_email", "not_configured", "already_sent"].includes(
          (sent as { reason?: string }).reason ?? ""
        );
        if (!benign) {
          console.error("auto_cha_send_failed", {
            shipmentId,
            reason: (sent as { reason?: string }).reason,
          });
        }
      } catch (err) {
        console.error("auto_cha_send_threw", {
          shipmentId,
          name: err instanceof Error ? err.name : "unknown",
        });
      }
    });

    return `✅ Thank you! Your documents for ${ref} are approved and locked. We'll send them to your customs broker and proceed with your shipment.`;
  }

  // Not a clear "yes". Don't bounce the shipment — a "hi" or "thanks" must not
  // change its state. Record the message so the operator can see it and decide
  // whether it's a real change request, then nudge the customer toward the
  // decision. The operator drives any revision from the dashboard.
  await supabase.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { customer_message: message },
  });

  console.log("customer_message_recorded", { shipmentId });
  return `Thanks for your message about ${ref}. If the documents look good, reply APPROVE to approve them. If you'd like any changes, send us the details and our team will take care of it.`;
}

// If this customer has a shipment waiting on missing PO fields, parse their
// text for those values, merge them in, and generate documents once complete.
// Returns a reply string when it handled the message, or null to fall through.
// Never logs the message body or field values (PII).
async function handleGapFillReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, reference_number, status, extracted_data")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_customer_info")
    .order("reference_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shipment) return null;

  const shipmentId = shipment.id as string;
  const ref = shipment.reference_number as string;
  const current = (shipment.extracted_data ?? {}) as Record<string, string>;

  const missing = missingRequiredFields(current);
  if (missing.length === 0) {
    // Operator already completed the fields from the dashboard; nothing to ask.
    return null;
  }

  const found = await parseGapReply(body.slice(0, 1000), missing);
  // Computed-value confirmation: if the invoice value is still missing and the
  // customer simply confirmed, fill it with the deterministic computation from
  // the stated unit price. Never override an explicit number they sent.
  let valueComputed = false;
  if (!found["value_amount"] && missing.includes("value_amount") && isValueConfirmation(body)) {
    const computed = computeProposedValue({ ...current, ...found });
    if (computed) {
      found["value_amount"] = computed.amount;
      valueComputed = true;
    }
  }
  const foundCount = Object.keys(found).length;

  if (foundCount > 0) {
    const merged = { ...current, ...found };
    await supabase
      .from("shipments")
      .update({ extracted_data: merged })
      .eq("id", shipmentId)
      .eq("status", "awaiting_customer_info");

    await supabase.from("audit_operator_action").insert({
      operator_id: null, // customer provided the values
      shipment_id: shipmentId,
      action_type: "extract",
      old_value: current,
      new_value: merged,
    });

    // Provenance: a computed-and-confirmed value wasn't printed on the PO.
    if (valueComputed) {
      await supabase.from("audit_operator_action").insert({
        operator_id: null,
        shipment_id: shipmentId,
        action_type: "note",
        old_value: null,
        new_value: {
          event: "value_amount_computed_and_confirmed",
          value: merged["value_amount"],
        },
      });
    }

    const stillMissing = missingRequiredFields(merged);
    console.log("gap_fill_reply_processed", {
      shipmentId,
      filledCount: foundCount,
      stillMissingCount: stillMissing.length,
    });

    if (stillMissing.length === 0) {
      // Trust gate: rules must accept the merged data before the agent acts
      // on it, and originally-extracted fields the model was unsure about
      // still need a human look (customer-filled fields carry confidence 1.0
      // from extraction, since they were blank there). Failures route to the
      // operator queue, not to generation.
      const issues = validateExtracted(merged);
      let storedConfidence: Record<string, number> = {};
      try {
        storedConfidence = JSON.parse(merged["_confidence"] ?? "{}");
      } catch {
        storedConfidence = {};
      }
      const shaky = lowConfidenceFields(merged, storedConfidence);
      if (issues.length > 0 || shaky.length > 0) {
        await supabase
          .from("shipments")
          .update({ status: "bucket_b_review" })
          .eq("id", shipmentId)
          .eq("status", "awaiting_customer_info");
        await supabase.from("audit_operator_action").insert({
          operator_id: null,
          shipment_id: shipmentId,
          action_type: "note",
          old_value: null,
          new_value: {
            event: "trust_gate_flagged",
            validation_issues: issues,
            low_confidence_fields: shaky,
          },
        });
        console.log("gap_fill_trust_gate", {
          shipmentId,
          issueCount: issues.length,
          lowConfidenceCount: shaky.length,
        });
        return `Thanks! I've noted the details for ${ref}. Our team will double-check everything and send your documents shortly.`;
      }

      // Denied-party screening on the buyer before the agent may act.
      const screening = await screenShipmentParties(shipmentId, partiesFromExtracted(merged));
      if (!screening.proceed) {
        await supabase
          .from("shipments")
          .update({ status: "sanctions_screening" })
          .eq("id", shipmentId)
          .eq("status", "awaiting_customer_info");
        return `Thanks! I've noted the details for ${ref}. Our team is running final compliance checks and will send your documents shortly.`;
      }

      // Atomic claim: only the request that actually flips the status gets to
      // generate. A concurrent reply matches zero rows here and must not
      // generate a duplicate document set.
      const { data: claimed } = await supabase
        .from("shipments")
        .update({ status: "generating_documents" })
        .eq("id", shipmentId)
        .eq("status", "awaiting_customer_info")
        .select("id");
      if (!claimed || claimed.length === 0) {
        return `Thanks — I've got everything for ${ref} and I'm preparing your documents now.`;
      }

      // Generate + send in the background so the TwiML reply beats Twilio's
      // ~15s webhook timeout. Agentic flow: documents go straight to the
      // customer; their APPROVE is the human gate. Any failure (including a
      // partial/thrown send) routes to the operator queue.
      after(async () => {
        const admin = createSupabaseServerClient();
        const toOperatorQueue = async () => {
          await admin
            .from("shipments")
            .update({ status: "bucket_b_review" })
            .eq("id", shipmentId)
            .eq("status", "generating_documents");
        };
        try {
          const invoice = await generateCommercialInvoiceCore(shipmentId, null);
          const packing = await generatePackingListCore(shipmentId, null);
          if (invoice.ok && packing.ok) {
            const sendResult = await sendDocsToCustomerCore(shipmentId, null);
            if (sendResult.ok) return;
          }
          await toOperatorQueue();
        } catch (err) {
          console.error("gap_fill_autosend_failed", {
            shipmentId,
            name: err instanceof Error ? err.name : "unknown",
          });
          await toOperatorQueue();
        }
      });

      return `✅ That's everything for ${ref} — thank you! I'm preparing your draft documents now; they'll arrive in this chat in about a minute. Reply APPROVE once you've checked them.`;
    }

    return (
      `Thanks — noted for ${ref}. I still need:\n` +
      missingFieldLines(stillMissing, merged).join("\n") +
      `\nJust reply with the details here.`
    );
  }

  // Nothing usable in the reply — repeat the ask.
  return (
    `Thanks for your message about ${ref}. To finish your documents I still need:\n` +
    missingFieldLines(missing, current).join("\n") +
    `\nJust reply with the details here.`
  );
}

// Create a shipment from an order sent as plain text (no PDF). The order text
// is stored as the shipment's customer note and is the source for extraction.
async function createTextOrderShipment(
  customerId: string,
  body: string
): Promise<{ shipmentId: string; shipmentRef: string } | null> {
  const supabase = createSupabaseServerClient();
  const shipmentRef = generateShipmentReference();
  const { data: shipment, error } = await supabase
    .from("shipments")
    .insert({
      customer_id: customerId,
      reference_number: shipmentRef,
      customer_po_number: body.slice(0, 300),
      status: "po_received",
    })
    .select("id")
    .single();
  if (error || !shipment) {
    console.error("text_order_shipment_create_failed", { code: error?.code });
    return null;
  }
  const shipmentId = shipment.id as string;
  await supabase.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "order_source", source: "whatsapp_text" },
  });
  return { shipmentId, shipmentRef };
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const configuredUrl = process.env.TWILIO_WEBHOOK_URL?.trim();

  if (!authToken) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const signature = req.headers.get("x-twilio-signature") ?? "";
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

  // Verify the Twilio signature against the URL Twilio actually called. We
  // accept the configured URL OR the live request host — this keeps the webhook
  // working on both the custom domain and the *.vercel.app domain. Security does
  // not rely on the host being unspoofable: the signature still requires
  // Twilio's auth token, so a forged request fails on every candidate URL.
  const host = req.headers.get("host");
  // x-forwarded-proto can be a comma-separated list behind proxies; take the first.
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  const candidateUrls = [
    configuredUrl,
    host ? `${proto}://${host}/api/whatsapp/webhook` : undefined,
  ].filter((u): u is string => !!u);

  if (candidateUrls.length === 0) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const valid = candidateUrls.some((u) =>
    twilio.validateRequest(authToken, signature, u, params)
  );
  if (!valid) {
    return new Response("Unauthorized", { status: 401 });
  }

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();
  const numMedia = parseInt(params.NumMedia ?? "0", 10);

  console.log("webhook_received", {
    hasFrom: !!from,
    bodyLength: body.length,
    numMedia,
    mediaUrl0Present: !!params.MediaUrl0,
    mediaUrl0Prefix: params.MediaUrl0?.slice(0, 80) ?? null,
    contentType0: params.MediaContentType0 ?? null,
  });

  if (!from) {
    return twimlResponse("Sorry, I couldn't read your message. Please try again.");
  }

  if (body.length > MAX_INPUT_LENGTH) {
    return twimlResponse(`Your message is too long. Please keep it under ${MAX_INPUT_LENGTH} characters.`);
  }

  if (isRateLimited(from)) {
    return twimlResponse("You're sending messages too fast. Please wait a minute and try again.");
  }

  const phoneHash = hashPhone(from);
  const customerId = await getOrCreateCustomer(phoneHash, from, params.ProfileName ?? "");

  if (!customerId) {
    return twimlResponse("Sorry, I'm having trouble setting up your profile. Please try again.");
  }

  if (numMedia > 0) {
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = params[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    const result = await handlePOSubmission({
      customerId,
      mediaUrls,
      messageBody: body,
    });

    if (!result) {
      return twimlResponse("I received your file but had trouble storing it. Please try sending again.");
    }

    if (result.duplicate) {
      return twimlResponse(
        `I've already got that document (ref ${result.shipmentRef}) and I'm working on it — your documents will arrive here shortly.`
      );
    }

    // Kick off the auto-pipeline AFTER the reply is sent: AI extraction ->
    // document generation -> review queue. Twilio gets its answer instantly.
    const readable = result.firstReadable;
    if (readable) {
      const shipmentId = result.shipmentId;
      const base64 = readable.base64;
      const mediaType = readable.mediaType;
      after(async () => {
        await runAutoPipeline({
          shipmentId,
          extract: () => extractPoFields(base64, mediaType),
        });
      });
      return twimlResponse(
        `Got your PO! Reference: ${result.shipmentRef}. I'm reading it now and preparing your draft documents — they'll be ready for review in about a minute.`
      );
    }

    return twimlResponse(
      `Got your PO! Saved ${result.fileCount} file(s). Shipment reference: ${result.shipmentRef}. Processing now.`
    );
  }

  if (!body) {
    return twimlResponse("Sorry, I couldn't read your message. Please try again.");
  }

  // Pending-shipment routing when a customer may have several live shipments.
  // An APPROVE-style keyword is an approval decision → approval handler first.
  // Any other text is far more likely answering a gap-fill question we asked,
  // so gap-fill takes precedence over the approval handler's change-request
  // path. This stops an awaiting-approval shipment from swallowing a reply that
  // was meant to fill another shipment's missing fields.
  try {
    if (isApprovalMessage(body)) {
      const approvalReply = await handleApprovalReply(customerId, body);
      if (approvalReply) return twimlResponse(approvalReply);
      const gapFillReply = await handleGapFillReply(customerId, body);
      if (gapFillReply) return twimlResponse(gapFillReply);
    } else {
      const gapFillReply = await handleGapFillReply(customerId, body);
      if (gapFillReply) return twimlResponse(gapFillReply);
      const approvalReply = await handleApprovalReply(customerId, body);
      if (approvalReply) return twimlResponse(approvalReply);
    }
  } catch (err) {
    console.error("pending_reply_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    // fall through to normal chat on error
  }

  // No pending shipment matched. Is this a NEW order typed as text (no PDF)?
  // A cheap classifier gates the expensive extraction so chit-chat stays chat.
  try {
    if (await isOrderMessage(body)) {
      // Dedupe: if the identical order text already created a shipment in the
      // last 10 minutes (a resend or a Twilio retry), don't make another.
      const dedupe = createSupabaseServerClient();
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: dup } = await dedupe
        .from("shipments")
        .select("reference_number")
        .eq("customer_id", customerId)
        .eq("customer_po_number", body.slice(0, 300))
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dup) {
        return twimlResponse(
          `I've already got that order (ref ${dup.reference_number}) and I'm working on it — your documents will arrive here shortly.`
        );
      }

      const created = await createTextOrderShipment(customerId, body);
      if (created) {
        const orderText = body;
        const shipmentId = created.shipmentId;
        after(async () => {
          await runAutoPipeline({
            shipmentId,
            extract: () => extractPoFieldsFromText(orderText),
          });
        });
        return twimlResponse(
          `Got your order! Reference: ${created.shipmentRef}. I'm reading it now and preparing your draft documents — ready for review in about a minute. If anything's missing I'll ask you here.`
        );
      }
    }
  } catch (err) {
    console.error("text_order_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    // fall through to normal chat on error
  }

  try {
    const result = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: body }],
    });

    const reply = result.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!reply) {
      return twimlResponse("Sorry, I couldn't generate a reply. Please try again.");
    }

    return twimlResponse(reply);
  } catch (err) {
    console.error("whatsapp_webhook_failed", {
      name: err instanceof Error ? err.name : "unknown",
      status: err instanceof Anthropic.APIError ? err.status : undefined,
    });
    return twimlResponse("Sorry, I'm having trouble right now. Please try again in a moment.");
  }
}

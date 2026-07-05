import { NextRequest, after } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import twilio from "twilio";
import { createHash, randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hashPhone } from "@/lib/hash";
import { runAutoPipeline, loadStoredExtraction } from "@/lib/docs/auto-pipeline";
import {
  extractPoFields,
  extractPoFieldsFromText,
  type SupportedMediaType,
} from "@/lib/ai/extract-po";
import { isOrderMessage } from "@/lib/ai/classify-order";
import { assessShipmentStatus } from "@/lib/ai/tracking-agent";
import { notifyCustomerWhatsApp } from "@/lib/whatsapp/notify";
import { missingRequiredFields, missingPackingFields, OPTIONAL_PACKING_LABELS } from "@/lib/docs/required-fields";
import { missingFieldLines, isValueConfirmation } from "@/lib/docs/gap-message";
import { computeProposedValue } from "@/lib/docs/compute-value";
import { validateExtracted, lowConfidenceFields, verifyConfirmedSnapshot } from "@/lib/docs/validate";
import {
  verifyAskMessage,
  verifyKeys,
  readStoredConfidence,
  readDraftedFields,
  readNeededFields,
} from "@/lib/docs/verify-gate";
import { parseGapReply } from "@/lib/ai/parse-gap-reply";
import { generateCoreDocSet } from "@/lib/docs/generate";
import { autoSendChaIfEnabled } from "@/lib/docs/send-to-cha-core";
import { createInvite } from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The auto-pipeline (AI extraction + doc generation) keeps running after the
// webhook reply is sent; give the function room to finish.
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Qra, a helpful AI assistant for Indian exporters. Respond briefly and helpfully in 1-3
   sentences.`;

const MAX_INPUT_LENGTH = 1000;
// A typed purchase order is legitimately long, so it gets a much higher cap than
// generic chat — but still bounded so an absurd message can't run up model cost.
const MAX_PO_INPUT_LENGTH = 8000;
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
): Promise<{ id: string; isNew: boolean } | null> {
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
      return { id: existing.id as string, isNew: false };
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
    return { id: inserted.id as string, isNew: true };
  } catch (err) {
    console.error("customer_lookup_exception", {
      name: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

// Welcome message with a one-time profile-setup link, for a brand-new exporter.
// Falls back to a plain welcome if the link can't be created.
async function onboardingWelcome(customerId: string): Promise<string> {
  const invite = await createInvite(customerId);
  if ("url" in invite) {
    return (
      "👋 Welcome to Qra! I turn your purchase orders into ready-to-file export " +
      "documents, right here on WhatsApp.\n\n" +
      `First, set up your company once (about 5 minutes) so your documents are complete:\n${invite.url}\n\n` +
      "Then just send me a purchase order — PDF, photo, or text — and I'll prepare your documents."
    );
  }
  return (
    "👋 Welcome to Qra! Send me a purchase order — PDF, photo, or text — and I'll " +
    "prepare your export documents. Our team will share your setup link shortly."
  );
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
  | { downloadFailed: true }
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

  // Every attachment failed to download (bad/expired Twilio URL, auth, or a
  // network blip). Don't create a ghost shipment with no file attached — return
  // a distinct result so the caller asks the customer to resend, instead of
  // claiming we're "processing" a PO that isn't there.
  if (downloaded.length === 0) {
    console.log("po_submission_no_files", { customerId });
    return { downloadFailed: true };
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

// Clear "no, don't process this" replies — used to decline an emailed PO at the
// order-confirm gate. Whole-message match only, so it can't catch a stray "no".
const DECLINE_PHRASES = new Set([
  "no", "nope", "nah", "cancel", "cancelled", "ignore", "discard",
  "reject", "rejected", "stop", "skip", "not this", "not mine", "delete",
]);

function isDeclineMessage(body: string): boolean {
  const norm = body
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return DECLINE_PHRASES.has(norm);
}

// If this customer has a shipment waiting on their approval, their text is an
// approve/change decision — not a general chat message. Returns a reply string
// when it handled the message, or null if nothing is pending (so the caller
// falls through to normal chat). Never logs the message body (may contain PII).
async function handleApprovalReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, reference_number, status, extracted_data")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_customer_approval")
    // When a customer has several pending shipments, a reply with no id is most
    // likely about the one we MOST RECENTLY touched — route by updated_at, with
    // reference_number (SHP-YYYYMMDD-xxxx) as a stable tiebreaker.
    .order("updated_at", { ascending: false })
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

    // Approval moves to the G3 goods-ready gate — docs approved + locked, but the
    // pack only goes to the CHA once the exporter confirms the goods are ready.
    // Guarded on the current status so a stale/duplicate reply can't clobber it.
    await supabase
      .from("shipments")
      .update({ status: "awaiting_goods_ready" })
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
        status_changed_to: "awaiting_goods_ready",
      },
    });

    console.log("customer_approval_recorded", { shipmentId, approvedCount });

    return `✅ Your documents for ${ref} are approved and locked. One last step: reply READY when your goods are ready to ship, and we'll hand everything to your customs broker.`;
  }

  // Maybe they're adding the OPTIONAL packing details (not an approval, not a
  // change request). Parse the reply for packing fields, fill them in, and
  // regenerate the packing list — non-blocking; the docs already went out.
  const current = (shipment.extracted_data ?? {}) as Record<string, string>;
  const missingPacking = missingPackingFields(current);
  if (missingPacking.length > 0) {
    const found = await parseGapReply(body.slice(0, 1000), missingPacking);
    if (Object.keys(found).length > 0) {
      const merged = { ...current, ...found };
      // Atomic shallow merge, still guarded on the status so a stale/duplicate
      // reply can't add packing to a shipment that already moved past approval.
      await supabase.rpc("merge_extracted_data", {
        p_shipment_id: shipmentId,
        p_patch: found,
        p_expected_status: "awaiting_customer_approval",
      });
      await supabase.from("audit_operator_action").insert({
        operator_id: null,
        shipment_id: shipmentId,
        action_type: "extract",
        old_value: current,
        new_value: merged,
      });
      after(async () => {
        try {
          // Redraft the whole set so the new packing weights flow into the
          // packing list AND the shipping-bill data sheet, not just one doc.
          await generateCoreDocSet(shipmentId, null);
        } catch (err) {
          console.error("packing_regen_failed", {
            shipmentId,
            name: err instanceof Error ? err.name : "unknown",
          });
        }
      });
      const added = Object.keys(found)
        .map((k) => OPTIONAL_PACKING_LABELS[k] ?? k)
        .join(", ");
      return `✅ Added ${added} to ${ref} and I'm updating your packing list. Reply APPROVE once you've checked it.`;
    }
  }

  // Not a clear "yes" and no packing details. Don't bounce the shipment — a "hi"
  // or "thanks" must not change its state. Record the message so the operator can
  // see it and decide whether it's a real change request, then nudge the customer
  // toward the decision. The operator drives any revision from the dashboard.
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

// Post-info completion: trust gate -> denied-party screening -> generate + send.
// Returns the reply to the customer. Shared by the gap-fill completion path and
// the "advance a complete-but-stuck shipment" path, so a shipment that already
// has everything it needs can never be stranded at awaiting_customer_info.
async function finishAndGenerate(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  shipmentId: string,
  ref: string,
  opts: { fromStatus?: string; skipLowConfidence?: boolean } = {}
): Promise<string> {
  const fromStatus = opts.fromStatus ?? "awaiting_customer_info";

  // The caller has already persisted the completed data (each path does its own
  // status-guarded merge, or passes data the row already holds), so the row is
  // complete here — deliberately don't re-write it. Writing a caller's read-time
  // snapshot back would clobber any concurrent write to a key it didn't touch (e.g.
  // an advisory agent's _certifications). Just claim the transition and re-run the
  // FULL pipeline from the stored row — so the HS auto-classify, the verify gate,
  // sanctions screening, the certification agent and document generation ALL run.
  // (A hand-rolled copy of the pipeline's tail used to drift out of sync and
  // silently skip the HS step for gap-fill POs.)

  // Claim the transition once so two replies can't both kick off processing.
  const { data: claimed } = await supabase
    .from("shipments")
    .update({ status: "data_extracting" })
    .eq("id", shipmentId)
    .eq("status", fromStatus)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return `Thanks — I've got everything for ${ref} and I'm preparing your documents now.`;
  }

  // skipLowConfidence flows through: the verify-correction caller passes true (the
  // human already vouched, so don't re-flag), the gap-fill caller passes nothing →
  // the full trust gate + HS step run.
  after(async () => {
    await runAutoPipeline({
      shipmentId,
      extract: () => loadStoredExtraction(shipmentId),
      skipLowConfidence: opts.skipLowConfidence,
    });
  });

  return `✅ That's everything for ${ref} — thank you! I'm preparing your draft documents now; they'll arrive in this chat shortly. Reply APPROVE once you've checked them.`;
}

// If this customer has a shipment waiting on missing PO fields, parse their
// text for those values, merge them in, and generate documents once complete.
// Returns a reply string when it handled the message, or null to fall through.
// Never logs the message body or field values (PII).
async function handleGapFillReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  // A customer can have several shipments parked here at once (incl. stale ones
  // left after the required-field rules changed). Pick the NEWEST one that still
  // has a missing required field — don't let an empty one shadow the real one.
  const { data: candidates } = await supabase
    .from("shipments")
    .select("id, reference_number, status, extracted_data")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_customer_info")
    .order("updated_at", { ascending: false })
    .order("reference_number", { ascending: false })
    .limit(10);

  const shipment = (candidates ?? []).find(
    (s) => missingRequiredFields((s.extracted_data ?? {}) as Record<string, string>).length > 0
  );
  if (!shipment) {
    // No shipment needs info — but a COMPLETE one may be stranded at this status
    // (its fields got finished by a rule change or an out-of-order reply). Advance
    // it instead of going silent (which dropped the reply to the generic chat).
    const stuck = (candidates ?? []).find(
      (s) => missingRequiredFields((s.extracted_data ?? {}) as Record<string, string>).length === 0
    );
    if (stuck) {
      return finishAndGenerate(
        supabase,
        stuck.id as string,
        stuck.reference_number as string
      );
    }
    return null;
  }

  const shipmentId = shipment.id as string;
  const ref = shipment.reference_number as string;
  const current = (shipment.extracted_data ?? {}) as Record<string, string>;

  const missing = missingRequiredFields(current);
  if (missing.length === 0) {
    // Belt-and-braces (find already filtered) — nothing left to ask.
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
    // Atomic shallow merge, still guarded on the status so a stale/duplicate reply
    // can't fill a shipment that already moved past the gap-fill gate.
    await supabase.rpc("merge_extracted_data", {
      p_shipment_id: shipmentId,
      p_patch: found,
      p_expected_status: "awaiting_customer_info",
    });

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
      return await finishAndGenerate(supabase, shipmentId, ref);
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

// A reply is ambiguous when a customer has several live shipments at different
// gates. Resolve it by recency: the reply most likely answers whichever gate they
// most recently entered. Includes the gap-fill gate (awaiting_customer_info) so a
// fresh "here's the missing value" reply isn't mis-ordered behind an older verify
// shipment. Returns that shipment's status, or null if no gate is pending.
async function newestAffirmativeGate(customerId: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("shipments")
    .select("status")
    .eq("customer_id", customerId)
    .in("status", [
      "awaiting_customer_approval",
      "awaiting_order_confirm",
      "awaiting_customer_verify",
      "awaiting_goods_ready",
      "awaiting_customer_info",
    ])
    // Most recently touched gate = the one the customer most likely just answered.
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.status as string) ?? null;
}

// A shipment parked at awaiting_goods_ready (G3) waits for the exporter to confirm
// the goods are ready to ship — only then is the approved pack handed to the CHA.
// Fires on a READY / affirmative reply; other text falls through. Never logs the
// body (PII). Returns a reply when handled, or null.
async function handleGoodsReadyReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, reference_number")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_goods_ready")
    .order("updated_at", { ascending: false })
    .order("reference_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment) return null;

  // Only a clear readiness signal advances it — accept "ready" or a plain yes/ok,
  // but NOT "approve"/"confirm" (document-approval words that could fire the CHA
  // hand-off before the goods are actually ready to ship). Block an explicit
  // refusal ("not ready", "not yet", "isn't ready") — but only when the negation
  // actually negates readiness, so a stray "no" in a positive reply ("no delays,
  // goods are ready") still advances. A bare "no" has no readiness word and falls
  // through the affirmative check below anyway.
  if (/(?:\bnot|n['’]?t)\s+(?:yet|ready|packed|done|finished|shipped|dispatched)\b/i.test(body)) return null;
  if (!/\b(ready|good to go|dispatched|shipped|yes|yeah|yep|ok|okay|done)\b/i.test(body)) return null;

  const shipmentId = shipment.id as string;
  const ref = shipment.reference_number as string;

  const { data: claimed } = await supabase
    .from("shipments")
    .update({ status: "customer_approved" })
    .eq("id", shipmentId)
    .eq("status", "awaiting_goods_ready")
    .select("id");
  if (!claimed || claimed.length === 0) return null; // already moving

  await supabase.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: { status: "awaiting_goods_ready" },
    new_value: { event: "goods_ready_confirmed", confirmed_by: "customer", via: "whatsapp" },
  });

  // Now the approved pack goes to the CHA (if the operator enabled auto-send).
  after(async () => {
    await autoSendChaIfEnabled(shipmentId, "customer_approved");
  });

  return `🚚 Thanks — goods marked ready for ${ref}. Your approved documents are ready for your customs broker.`;
}

// A shipment parked at awaiting_customer_verify is waiting for the EXPORTER to
// confirm (or correct) the fields Qra wasn't sure about — the G1 gate. Any field
// values they send are applied first; a clear CONFIRM then proceeds. A field
// that's still malformed is re-asked (finishAndGenerate routes it back here).
// Returns a reply when handled, or null to fall through. Never logs the body (PII).
async function handleVerifyReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, reference_number, extracted_data")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_customer_verify")
    .order("updated_at", { ascending: false })
    .order("reference_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment) return null;

  const shipmentId = shipment.id as string;
  const ref = shipment.reference_number as string;
  const current = (shipment.extracted_data ?? {}) as Record<string, string>;

  const issues = validateExtracted(current);
  const shaky = lowConfidenceFields(current, readStoredConfidence(current));

  // Did they send corrected values? Parse the reply for the flagged fields (incl.
  // any Qra needs them to PROVIDE, like an HS code) and merge them in.
  const found = await parseGapReply(body.slice(0, 1000), verifyKeys(current, issues, shaky));
  let merged = current;
  if (Object.keys(found).length > 0) {
    const changed = Object.keys(found);
    merged = { ...current, ...found };
    // Clear the "Qra drafted this" / "exporter still owes this" markers for the
    // fields the exporter just corrected, and lift their confidence — the human
    // has now vouched for them. Mirrors the portal verify path so the two channels
    // leave identical internal state (otherwise a corrected HS code still carries a
    // hidden "Qra guessed this" note forever).
    merged["_drafted"] = JSON.stringify(readDraftedFields(merged).filter((f) => !changed.includes(f)));
    merged["_needed"] = JSON.stringify(readNeededFields(merged).filter((f) => !changed.includes(f)));
    const conf = readStoredConfidence(merged);
    for (const k of changed) conf[k] = 0.99;
    merged["_confidence"] = JSON.stringify(conf);
    // Atomic shallow merge of just the corrected fields + the recomputed markers,
    // still guarded on the status so a stale reply can't correct a shipment that
    // already left the verify gate.
    await supabase.rpc("merge_extracted_data", {
      p_shipment_id: shipmentId,
      p_patch: {
        ...found,
        _drafted: merged["_drafted"],
        _needed: merged["_needed"],
        _confidence: merged["_confidence"],
      },
      p_expected_status: "awaiting_customer_verify",
    });
    // Audit the correction by field NAME only — never dump the full extracted_data
    // (PII: buyer, value, addresses) into the trail.
    await supabase.from("audit_operator_action").insert({
      operator_id: null, // customer corrected the values
      shipment_id: shipmentId,
      action_type: "extract",
      old_value: null,
      new_value: { event: "fields_corrected", via: "whatsapp", fields: changed },
    });
  }

  // Proceed when they confirmed OR sent a correction (the human vouched for the
  // values). finishAndGenerate skips the low-confidence check but still rejects a
  // malformed field — re-asking here — and still runs sanctions screening.
  if (isApprovalMessage(body) || Object.keys(found).length > 0) {
    // Snapshot the values they're confirming (their PRE-correction, shown values)
    // so an unchanged ambiguous/mismatched value doesn't re-flag on the resume and
    // loop the gate; a value they CHANGED re-validates (new value ≠ this snapshot).
    // Status-guarded like the correction merge above.
    await supabase.rpc("merge_extracted_data", {
      p_shipment_id: shipmentId,
      p_patch: { _verify_confirmed: verifyConfirmedSnapshot(current) },
      p_expected_status: "awaiting_customer_verify",
    });
    return await finishAndGenerate(supabase, shipmentId, ref, {
      fromStatus: "awaiting_customer_verify",
      skipLowConfidence: true,
    });
  }

  // Neither a confirm nor a usable correction — repeat the ask.
  return verifyAskMessage(ref, current, issues, shaky);
}

// A shipment created from a forwarded EMAIL PO parks at awaiting_order_confirm
// until the exporter confirms it here on WhatsApp (blueprint order.confirm gate).
// A clear CONFIRM resumes the pipeline; a clear NO cancels it. Returns a reply
// when it clearly handled the message, or null to fall through (ambiguous
// replies are left alone so they can't swallow another shipment's answer).
// Never logs the message body (may contain PII).
async function handleOrderConfirmReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, reference_number")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_order_confirm")
    .order("updated_at", { ascending: false })
    .order("reference_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shipment) return null;

  const shipmentId = shipment.id as string;
  const ref = shipment.reference_number as string;

  if (isApprovalMessage(body)) {
    // Atomic claim so a duplicate/concurrent reply can't double-run the pipeline.
    const { data: claimed } = await supabase
      .from("shipments")
      .update({ status: "data_extracting" })
      .eq("id", shipmentId)
      .eq("status", "awaiting_order_confirm")
      .select("id");
    if (!claimed || claimed.length === 0) {
      return `Thanks — I'm already preparing your documents for ${ref}.`;
    }

    await supabase.from("audit_operator_action").insert({
      operator_id: null, // customer confirmed, not an operator
      shipment_id: shipmentId,
      action_type: "approve",
      old_value: { status: "awaiting_order_confirm" },
      new_value: { event: "order_confirmed", confirmed_by: "customer" },
    });

    // Resume the pipeline from the stored draft — no second paid extraction.
    after(async () => {
      await runAutoPipeline({
        shipmentId,
        extract: () => loadStoredExtraction(shipmentId),
      });
    });

    console.log("order_confirmed", { shipmentId });
    return `✅ Great — preparing your export documents for ${ref} now. They'll arrive here in about a minute; reply APPROVE once you've checked them.`;
  }

  if (isDeclineMessage(body)) {
    await supabase
      .from("shipments")
      .update({ status: "order_declined" })
      .eq("id", shipmentId)
      .eq("status", "awaiting_order_confirm");
    await supabase.from("audit_operator_action").insert({
      operator_id: null,
      shipment_id: shipmentId,
      action_type: "note",
      old_value: { status: "awaiting_order_confirm" },
      new_value: { event: "order_declined", declined_by: "customer" },
    });
    console.log("order_declined", { shipmentId });
    return `No problem — I won't process that PO (${ref}). Send me another anytime.`;
  }

  // Ambiguous — leave it parked and fall through (don't swallow other replies).
  return null;
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

// Cheap gate: decide whether a plain-text WhatsApp message is a CARRIER / TRACKING
// update about a shipment already in transit (a forwarded shipping-line email or
// status: vessel departed/arrived, container milestone, ETA change, gate-in/out, a
// hold/delay at port) — versus a greeting, a question, a new order, or chit-chat.
// Conservative: unsure ⇒ false, so it can never hijack a chat reply or a new order.
// Never logs the body (PII). Modeled on classify-order.ts (Haiku, tiny max_tokens).
async function isTrackingUpdate(text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (trimmed.length < 15) return false;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 80,
        system:
          "You decide if a WhatsApp message from an exporter is a CARRIER / SHIPMENT TRACKING update about a shipment already in transit — e.g. a forwarded shipping-line email or status: vessel departed/arrived, a container/booking milestone, an ETA change, gate-in/gate-out, or a hold/delay at port. It is NOT a tracking update if it is a greeting, a general question, a new purchase order, or chit-chat. Be conservative: only say yes when the message clearly reports a shipment's movement or status.",
        tools: [
          {
            name: "classify",
            description: "Record whether the message is a carrier/tracking update.",
            input_schema: {
              type: "object",
              properties: { is_tracking: { type: "boolean" } },
              required: ["is_tracking"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "classify" },
        messages: [{ role: "user", content: trimmed.slice(0, 1500) }],
      },
      { timeout: 30_000 }
    );
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const input = (toolUse?.input ?? {}) as { is_tracking?: unknown };
    return input.is_tracking === true;
  } catch (err) {
    // On any classification failure, treat as NOT a tracking update — fall through
    // to normal order/chat handling rather than acting on a message we can't read.
    console.error("tracking_classify_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}

// A customer with an in-flight (post-filing) shipment can forward a carrier /
// tracking update; Qra's Tracking agent reads it into a clean status + ETA and
// flags demurrage risk. Gated cheaply: ONE indexed query for a post-filing
// shipment (skips entirely if none), THEN a tiny Haiku classifier — unsure ⇒ not a
// tracking update, so it falls through. Persists the SAME reserved _tracking shape
// the operator paste path stores, so the exporter portal + agent-fleet card update
// identically. Returns a reply when handled, or null to fall through. Never logs
// the body (PII).
// KNOWN LIMITATION (not solved here): if several post-filing shipments are live at
// once, the update is applied to the most-recently-active one (same "newest"
// convention as the other reply handlers) — a forwarded carrier email doesn't tell
// us which shipment it names. Also: this runs BEFORE the new-order classifier, so a
// Haiku false-positive on an order-looking message would consume it as tracking —
// the prompt explicitly excludes new POs to keep that unlikely.
async function handleTrackingReply(customerId: string, body: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();

  // Cheap gate + target in one indexed query: the newest post-filing shipment.
  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, reference_number")
    .eq("customer_id", customerId)
    .in("status", ["filed_with_cha", "customs_cleared", "in_transit", "delivered"])
    .order("updated_at", { ascending: false })
    .order("reference_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shipment) return null;

  // Only now — for a customer who actually has something in flight — spend a Haiku
  // call to decide if this text is a carrier/tracking update. Unsure fails safe.
  if (!(await isTrackingUpdate(body))) return null;

  const shipmentId = shipment.id as string;
  const ref = shipment.reference_number as string;
  const couldntRead = `Thanks — I couldn't read that tracking update for ${ref} automatically. Our team will check it and follow up.`;

  // The Sonnet read below is too slow for Twilio's ~15s webhook window — a slow
  // read would drop the reply (and its demurrage warning) entirely. So ACK the
  // customer instantly and run the read + persist in after(), delivering the
  // final summary via an outbound send — the same pattern the PO pipeline uses.
  after(async () => {
    try {
      // Free days from the awarded carrier, if any — same derivation the operator
      // path uses, so the demurrage check reads the identical context.
      const { data: awarded } = await supabase
        .from("freight_quotes")
        .select("free_days")
        .eq("shipment_id", shipmentId)
        .eq("decision", "awarded")
        .limit(1)
        .maybeSingle();
      const freeDays = awarded?.free_days;
      const freeDaysNote =
        freeDays != null ? `Free days at destination (from the awarded carrier): ${freeDays}.` : "";

      const status = await assessShipmentStatus(body.slice(0, 4000), freeDaysNote);
      if (!status) {
        // Don't fake success — the agent couldn't read it. Hand it to the team.
        await notifyCustomerWhatsApp(supabase, customerId, couldntRead);
        return;
      }

      // Persist under the reserved _tracking key via an atomic shallow merge —
      // byte-for-byte the same shape the operator path writes, but the merge under
      // the row lock preserves any key written concurrently.
      await supabase.rpc("merge_extracted_data", {
        p_shipment_id: shipmentId,
        p_patch: { _tracking: JSON.stringify(status) },
      });
      await supabase.from("audit_operator_action").insert({
        operator_id: null, // customer forwarded the update, not an operator
        shipment_id: shipmentId,
        action_type: "note",
        old_value: null,
        new_value: { event: "tracking_assessed", via: "whatsapp" },
      });

      let summary = `📍 Update on ${ref}: ${status.summary}`;
      if (status.riskNote) summary += `\n\n⚠️ ${status.riskNote}`;
      await notifyCustomerWhatsApp(supabase, customerId, summary);
    } catch (err) {
      console.error("tracking_after_failed", {
        name: err instanceof Error ? err.name : "unknown",
      });
      await notifyCustomerWhatsApp(supabase, customerId, couldntRead);
    }
  });

  return `📍 Got your update on ${ref} — reading it now, I'll send the status in a moment.`;
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

  if (isRateLimited(from)) {
    return twimlResponse("You're sending messages too fast. Please wait a minute and try again.");
  }

  const phoneHash = hashPhone(from);
  const customer = await getOrCreateCustomer(phoneHash, from, params.ProfileName ?? "");

  if (!customer) {
    return twimlResponse("Sorry, I'm having trouble setting up your profile. Please try again.");
  }
  const customerId = customer.id;
  const isNewCustomer = customer.isNew;

  if (numMedia > 0) {
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = params[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    // A brand-new exporter who leads with a PO still needs to set up their
    // company once, so append a one-time setup link to the acknowledgement.
    let setupNote = "";
    if (isNewCustomer) {
      const invite = await createInvite(customerId);
      if ("url" in invite) {
        setupNote = `\n\nP.S. set up your company once so your documents are complete: ${invite.url}`;
      }
    }

    const result = await handlePOSubmission({
      customerId,
      mediaUrls,
      messageBody: body,
    });

    if (!result) {
      return twimlResponse("I received your file but had trouble storing it. Please try sending again.");
    }

    if ("downloadFailed" in result) {
      return twimlResponse("I couldn't download your file — please resend it, and I'll get started.");
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
        `Got your PO! Reference: ${result.shipmentRef}. I'm reading it now and preparing your draft documents — they'll be ready for review in about a minute.${setupNote}`
      );
    }

    // A file was stored but none of it is AI-readable (e.g. a voice note or an
    // unsupported type), so no pipeline was scheduled. Don't claim we're
    // processing it — hand it to the operator's review queue (bucket_b_review,
    // the same status the pipeline uses when it can't proceed automatically, so
    // it surfaces on the dashboard + review queue) and tell the customer a human
    // will follow up. Guarded on po_received so we never clobber another state.
    const admin = createSupabaseServerClient();
    await admin
      .from("shipments")
      .update({ status: "bucket_b_review" })
      .eq("id", result.shipmentId)
      .eq("status", "po_received");
    await admin.from("audit_operator_action").insert({
      operator_id: null,
      shipment_id: result.shipmentId,
      action_type: "note",
      old_value: null,
      new_value: { event: "unreadable_media_manual_review" },
    });
    return twimlResponse(
      `I've received your PO (ref ${result.shipmentRef}) but I couldn't read it automatically — our team will review it and follow up with you shortly. Nothing you need to do right now.${setupNote}`
    );
  }

  if (!body) {
    return twimlResponse("Sorry, I couldn't read your message. Please try again.");
  }

  // A brand-new exporter messaging for the first time gets a welcome + a
  // one-time setup link, so they can fill their company profile.
  if (isNewCustomer) {
    return twimlResponse(await onboardingWelcome(customerId));
  }

  // Pending-shipment routing when a customer may have several live shipments.
  // An APPROVE-style keyword is an approval decision → approval handler first.
  // Any other text is far more likely answering a gap-fill question we asked,
  // so gap-fill takes precedence over the approval handler's change-request
  // path. This stops an awaiting-approval shipment from swallowing a reply that
  // was meant to fill another shipment's missing fields.
  try {
    if (isApprovalMessage(body)) {
      // "yes/confirm" answers the customer's MOST RECENT gate — confirm the
      // newest emailed order, or approve the newest ready docs. This stops a
      // stale awaiting-approval shipment from swallowing a fresh order's CONFIRM.
      // Gap-fill (value confirmation) stays the final fallback, as before.
      const gate = await newestAffirmativeGate(customerId);
      // "yes/confirm" answers the customer's MOST RECENT gate. Each gate handler
      // only fires on its own status, so this ordering is purely about which to
      // try first when several gates are pending for one customer at once.
      const affirmativeHandlers =
        gate === "awaiting_customer_info"
          ? [handleGapFillReply, handleApprovalReply, handleGoodsReadyReply, handleOrderConfirmReply, handleVerifyReply]
          : gate === "awaiting_customer_verify"
            ? [handleVerifyReply, handleGoodsReadyReply, handleApprovalReply, handleOrderConfirmReply]
            : gate === "awaiting_order_confirm"
              ? [handleOrderConfirmReply, handleGoodsReadyReply, handleApprovalReply, handleVerifyReply]
              : gate === "awaiting_goods_ready"
                ? [handleGoodsReadyReply, handleApprovalReply, handleOrderConfirmReply, handleVerifyReply]
                : [handleApprovalReply, handleGoodsReadyReply, handleOrderConfirmReply, handleVerifyReply];
      for (const handler of affirmativeHandlers) {
        const reply = await handler(customerId, body);
        if (reply) return twimlResponse(reply);
      }
      const gapFillReply = await handleGapFillReply(customerId, body);
      if (gapFillReply) return twimlResponse(gapFillReply);
    } else {
      // Other text is most likely a gap-fill answer, then a verify-gate
      // correction, then a goods-ready signal, then a change request on a doc
      // awaiting approval. BUT if the customer's most-recent gate is the verify
      // gate, a free-text reply is most likely the value it asked for (e.g. an HS
      // code) — run verify FIRST so a competing awaiting-info shipment can't swallow
      // it. Order-confirm stays LAST so a bare "no" can't cancel a different order.
      const gate = await newestAffirmativeGate(customerId);
      const handlers =
        gate === "awaiting_customer_verify"
          ? [handleVerifyReply, handleGapFillReply, handleGoodsReadyReply, handleApprovalReply, handleOrderConfirmReply]
          : [handleGapFillReply, handleVerifyReply, handleGoodsReadyReply, handleApprovalReply, handleOrderConfirmReply];
      for (const handler of handlers) {
        const reply = await handler(customerId, body);
        if (reply) return twimlResponse(reply);
      }
    }
  } catch (err) {
    console.error("pending_reply_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    // fall through to normal chat on error
  }

  // No pending gate matched. If this customer has a shipment in flight (post-
  // filing), the message may be a forwarded carrier / tracking update. Gated
  // cheaply (one indexed query, then a tiny Haiku classifier) and fails SAFE, so
  // it sits AFTER the pending gates (approval/verify/gap-fill) and BEFORE the
  // new-order classifier + chat: a live gate answer or a genuine new PO still wins.
  try {
    const trackingReply = await handleTrackingReply(customerId, body);
    if (trackingReply) return twimlResponse(trackingReply);
  } catch (err) {
    console.error("tracking_reply_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    // fall through to normal order/chat on error
  }

  // A typed order can be long (real POs are), so it must NOT be blocked by the
  // short chat cap below — but still bound what reaches the classifier/extractor
  // so an absurdly long message can't run up model cost. (Both model calls also
  // slice their own input as a second line of defence.)
  if (body.length > MAX_PO_INPUT_LENGTH) {
    return twimlResponse(`Your message is too long. Please keep it under ${MAX_PO_INPUT_LENGTH} characters.`);
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

  // Generic chat with Claude is the only path that sends the WHOLE message to
  // the model, so the short input cap lives HERE — not before the PO paths,
  // which are legitimately long.
  if (body.length > MAX_INPUT_LENGTH) {
    return twimlResponse(`Your message is too long. Please keep it under ${MAX_INPUT_LENGTH} characters.`);
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

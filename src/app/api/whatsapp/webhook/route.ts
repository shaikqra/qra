import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import twilio from "twilio";
import { createHash, randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hashPhone } from "@/lib/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function getOrCreateCustomer(phoneHash: string): Promise<string | null> {
  try {
    const supabase = createSupabaseServerClient();
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("phone_hash", phoneHash)
      .maybeSingle();
    if (existing) return existing.id as string;
    const { data: inserted, error } = await supabase
      .from("customers")
      .insert({ phone_hash: phoneHash })
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
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.error("media_download_failed", { stage: "env_missing", hasSid: !!sid, hasToken: !!token });
    return null;
  }
  const authHeader = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  try {
    console.log("media_download_start", { urlPrefix: url.slice(0, 100) });
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

async function handlePOSubmission({
  customerId,
  mediaUrls,
  messageBody,
}: {
  customerId: string;
  mediaUrls: string[];
  messageBody: string;
}): Promise<{ shipmentRef: string; fileCount: number } | null> {
  const supabase = createSupabaseServerClient();
  const shipmentRef = generateShipmentReference();
  console.log("po_submission_start", { customerId, mediaUrlCount: mediaUrls.length, shipmentRef });

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

  for (let i = 0; i < mediaUrls.length; i++) {
    const url = mediaUrls[i];
    if (!url) {
      console.warn("media_url_empty", { index: i });
      continue;
    }
    console.log("processing_media", { index: i });
    const media = await downloadTwilioMedia(url);
    if (!media) {
      console.warn("media_download_returned_null", { index: i });
      continue;
    }

    const sha256 = createHash("sha256").update(media.bytes).digest("hex");
    const ext = extensionFromContentType(media.contentType);
    const storagePath = `${customerId}/${shipmentId}/${sha256.slice(0, 16)}-${i}.${ext}`;
    console.log("uploading_to_storage", { storagePath, bytes: media.bytes.length, contentType: media.contentType
  });

    const { error: uploadErr } = await supabase.storage
      .from("purchase-orders")
      .upload(storagePath, media.bytes, {
        contentType: media.contentType,
        upsert: false,
      });

    if (uploadErr) {
      console.error("storage_upload_failed", {
        name: uploadErr.name,
        message: uploadErr.message,
      });
      continue;
    }
    console.log("storage_upload_success", { storagePath });

    const { error: auditErr } = await supabase.from("audit_po_ingest").insert({
      customer_id: customerId,
      shipment_id: shipmentId,
      storage_path: storagePath,
      file_sha256: sha256,
      source: "whatsapp",
    });

    if (auditErr) {
      console.error("audit_log_failed", { code: auditErr.code, message: auditErr.message });
    }

    storedCount++;
  }

  console.log("po_submission_complete", { storedCount, totalUrls: mediaUrls.length });
  return { shipmentRef, fileCount: storedCount };
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL;

  if (!authToken || !webhookUrl) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const signature = req.headers.get("x-twilio-signature") ?? "";
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

  const valid = twilio.validateRequest(authToken, signature, webhookUrl, params);
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
  const customerId = await getOrCreateCustomer(phoneHash);

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

    return twimlResponse(
      `Got your PO! Saved ${result.fileCount} file(s). Shipment reference: ${result.shipmentRef}. Processing now.`
    );
  }

  if (!body) {
    return twimlResponse("Sorry, I couldn't read your message. Please try again.");
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

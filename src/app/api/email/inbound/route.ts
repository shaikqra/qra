import { NextRequest, after } from "next/server";
import { extractPoFields } from "@/lib/ai/extract-po";
import { runAutoPipeline } from "@/lib/docs/auto-pipeline";
import {
  verifyResendSignature,
  resolveCustomerByInbound,
  fetchInboundAttachment,
  ingestEmailPo,
} from "@/lib/email/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The auto-pipeline keeps running after the 200; give the function room.
export const maxDuration = 60;

// Per-exporter cost guard: each accepted PO triggers a paid AI extraction.
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

type ReceivedEvent = {
  type?: string;
  data?: { to?: unknown; email_id?: unknown; subject?: unknown };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // The Svix signature is the auth — only Resend can sign with our secret.
  if (
    !verifyResendSignature(rawBody, {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    })
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: ReceivedEvent;
  try {
    event = JSON.parse(rawBody) as ReceivedEvent;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Acknowledge non-received events with 200 so Resend doesn't retry.
  if (event.type !== "email.received") return new Response("ignored", { status: 200 });

  const data = event.data ?? {};
  const toList = Array.isArray(data.to) ? (data.to as unknown[]).map(String) : [];
  const emailId = typeof data.email_id === "string" ? data.email_id : "";
  const subject = typeof data.subject === "string" ? data.subject : "";

  const customerId = await resolveCustomerByInbound(toList);
  if (!customerId || !emailId) return new Response("no_match", { status: 200 });

  if (rateLimited(customerId)) return new Response("rate_limited", { status: 200 });

  const att = await fetchInboundAttachment(emailId);
  if (!att.ok) {
    // Echo the precise reason in the body so it's visible in Resend's webhook
    // log (status codes / JSON shape only — no PII). Acknowledge with 200.
    console.error("inbound_no_attachment", { emailId: emailId.slice(0, 8), reason: att.reason });
    return new Response(`no_attachment:${att.reason}`, { status: 200 });
  }
  const file = att.file;

  const result = await ingestEmailPo(
    customerId,
    { bytes: file.bytes, contentType: file.contentType },
    subject,
    emailId
  );
  if (!result) return new Response("ingest_failed", { status: 200 });

  // A retry of an already-ingested email — acknowledge, don't re-run the pipeline.
  if (result.duplicate) return new Response("duplicate", { status: 200 });

  // Same AI pipeline as the WhatsApp path, after the 200 is returned.
  const shipmentId = result.shipmentId;
  const base64 = file.base64;
  const mediaType = file.mediaType;
  after(async () => {
    try {
      // confirmFirst: an emailed PO is drafted, then parks for the exporter to
      // confirm on WhatsApp before any documents are generated.
      await runAutoPipeline({
        shipmentId,
        extract: () => extractPoFields(base64, mediaType),
        confirmFirst: true,
      });
    } catch (e) {
      console.error("inbound_pipeline_threw", {
        shipmentId,
        name: e instanceof Error ? e.name : "unknown",
      });
    }
  });

  console.log("inbound_email_po", { shipmentId });
  return new Response("ok", { status: 200 });
}

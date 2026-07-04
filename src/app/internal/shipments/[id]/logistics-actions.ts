"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { draftBookingRequest, type BookingDraft } from "@/lib/ai/logistics-agent";
import { sendBookingRequestCore } from "@/lib/logistics/send-booking";
import { parseBookingConfirmation, type ParsedBookingConfirmation } from "@/lib/ai/parse-booking-confirmation";

type BookingResult = { ok: true; draft: BookingDraft } | { ok: false; error: string };

const RATE_MAX = 6;
const SEND_RATE_MAX = 4; // tighter cap for OUTBOUND email actions
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();
function rateLimited(key: string, max = RATE_MAX): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

// Logistics agent — draft an inland booking request from the shipment's cargo and
// the awarded carrier. Returns the draft for the operator to review and send.
export async function draftBookingAction(shipmentId: string): Promise<BookingResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`booking:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("reference_number, extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const d = (ship.extracted_data ?? {}) as Record<string, string>;
  const g = (k: string) => (d[k] ?? "").trim();

  const { data: awarded } = await admin
    .from("freight_quotes")
    .select("carrier_name")
    .eq("shipment_id", shipmentId)
    .eq("decision", "awarded")
    .limit(1)
    .maybeSingle();

  const draft = await draftBookingRequest({
    reference: (ship.reference_number as string) ?? "",
    product: g("product_description"),
    packages: [g("number_of_packages"), g("package_type")].filter(Boolean).join(" "),
    grossWeight: [g("gross_weight"), g("weight_unit")].filter(Boolean).join(" "),
    portOfLoading: g("port_of_loading"),
    carrier: ((awarded?.carrier_name as string) ?? "").trim(),
  });
  if (!draft) return { ok: false, error: "Couldn't draft the booking — add a product description first." };

  // Persist the draft so it survives a refresh and the fleet card reflects it.
  // Atomic merge of just the reserved _booking_draft key — every other key is preserved.
  await admin.rpc("merge_extracted_data", {
    p_shipment_id: shipmentId,
    p_patch: { _booking_draft: JSON.stringify(draft) },
  });
  await admin.from("audit_operator_action").insert({
    operator_id: session.userId,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "booking_drafted" },
  });

  return { ok: true, draft };
}

// Send a drafted booking request to a transporter email. Operator reviews the
// draft, enters the transporter, sends. Writes an audit row (see
// sendBookingRequestCore). Mirrors sendFreightRfqAction.
export async function sendBookingRequestAction(
  shipmentId: string,
  transporterEmail: string,
  subject: string,
  body: string
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`bookingsend:${session.userId}`, SEND_RATE_MAX)) {
    return { ok: false, error: "Please wait a moment and try again." };
  }
  const r = await sendBookingRequestCore(shipmentId, session.userId, transporterEmail, subject, body);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.audited) return { ok: true, warning: "Email sent, but logging it failed — please flag this." };
  return { ok: true };
}

// Parse a transporter's reply to the booking request. Operator pastes the reply;
// the Logistics agent reads whether they confirmed, the pickup date, container and
// cost. Extracts only what the transporter stated (never invents). Advisory only —
// stores the result inside the existing _booking_draft so the panel shows it after
// a refresh. Requires a draft to exist first.
export async function parseBookingReplyAction(
  shipmentId: string,
  pastedText: string
): Promise<{ ok: true; confirmation: ParsedBookingConfirmation } | { ok: false; error: string }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`bookingparse:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (!pastedText.trim()) return { ok: false, error: "Paste the transporter's reply first." };

  const admin = createSupabaseServerClient();
  // A reply only makes sense once a booking request has been drafted/sent. Check
  // BEFORE spending a paid AI call, and return a friendly nudge if there's no draft.
  const { data: pre } = await admin
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!pre) return { ok: false, error: "Shipment not found." };
  const pd = (pre.extracted_data ?? {}) as Record<string, string>;
  let hasDraft = false;
  try {
    const dObj = JSON.parse(pd["_booking_draft"] || "null") as { subject?: string } | null;
    hasDraft = !!(dObj && dObj.subject);
  } catch {
    hasDraft = false;
  }
  if (!hasDraft) return { ok: false, error: "Draft and send the booking request first." };

  const parsed = await parseBookingConfirmation(pastedText);
  if (!parsed) return { ok: false, error: "Couldn't read a reply from that text." };

  // Merge the confirmation onto the reserved _booking_draft key. Re-fetch the
  // FRESHEST extracted_data first — the parser call above is slow enough for a
  // concurrent write (send stamp, gap-fill reply, tracking update) to land, and
  // stamping onto a stale copy would silently erase it.
  const confirmedAt = new Date().toISOString();
  try {
    const { data: fresh } = await admin
      .from("shipments")
      .select("extracted_data")
      .eq("id", shipmentId)
      .maybeSingle();
    const d = (fresh?.extracted_data ?? {}) as Record<string, string>;
    const draftObj = JSON.parse(d["_booking_draft"] || "null") as { subject?: string } | null;
    if (draftObj && draftObj.subject) {
      // Atomic merge of just the reserved _booking_draft key — every other key is preserved.
      await admin.rpc("merge_extracted_data", {
        p_shipment_id: shipmentId,
        p_patch: { _booking_draft: JSON.stringify({ ...draftObj, confirmation: parsed, confirmedAt }) },
      });
    }
  } catch {
    // Unreadable draft key — the audit row below is still the durable record.
  }

  // Audit the parse. No PII beyond the confirmed flag — no dates, cost or notes.
  const { error: auditErr } = await admin.from("audit_operator_action").insert({
    operator_id: session.userId,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "booking_reply_parsed", confirmed: parsed.confirmed },
  });
  if (auditErr) console.error("booking_reply_audit_write_failed", { shipmentId });

  return { ok: true, confirmation: parsed };
}

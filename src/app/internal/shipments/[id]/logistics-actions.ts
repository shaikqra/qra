"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { draftBookingRequest, type BookingDraft } from "@/lib/ai/logistics-agent";

type BookingResult = { ok: true; draft: BookingDraft } | { ok: false; error: string };

const RATE_MAX = 6;
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
  await admin
    .from("shipments")
    .update({ extracted_data: { ...d, _booking_draft: JSON.stringify(draft) } })
    .eq("id", shipmentId);
  await admin.from("audit_operator_action").insert({
    operator_id: session.userId,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "booking_drafted" },
  });

  return { ok: true, draft };
}

"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { draftFreightRfq, type FreightRfq } from "@/lib/ai/freight-agent";
import { sendFreightRfqCore } from "@/lib/freight/send-rfq";

type RfqResult = { ok: true; rfq: FreightRfq } | { ok: false; error: string };

// Best-effort per-operator throttle (in-memory, per server instance) — caps paid
// AI bursts from one reviewer mashing the button. Operator auth is the real guard.
const RATE_MAX = 8;
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

// Freight agent (G4) — draft a carrier RFQ from this shipment's cargo. Returns the
// drafted email for the operator to review and send. Drafts only; sends nothing.
export async function draftFreightRfqAction(shipmentId: string): Promise<RfqResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`rfq:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("reference_number, extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const d = (ship.extracted_data ?? {}) as Record<string, string>;
  const g = (k: string) => (d[k] ?? "").trim();

  const rfq = await draftFreightRfq({
    reference: (ship.reference_number as string) ?? "",
    product: g("product_description"),
    quantity: [g("quantity"), g("quantity_unit")].filter(Boolean).join(" "),
    packages: [g("number_of_packages"), g("package_type")].filter(Boolean).join(" "),
    grossWeight: [g("gross_weight"), g("weight_unit")].filter(Boolean).join(" "),
    portOfLoading: g("port_of_loading"),
    portOfDischarge: g("port_of_discharge"),
    destinationCountry: g("destination_country"),
    incoterm: g("incoterm"),
  });
  if (!rfq) return { ok: false, error: "Couldn't draft the RFQ — add a product description first." };
  return { ok: true, rfq };
}

// Send a drafted RFQ to a carrier email. Operator reviews the draft, enters the
// carrier, sends. Writes an audit row (see sendFreightRfqCore).
export async function sendFreightRfqAction(
  shipmentId: string,
  carrierEmail: string,
  subject: string,
  body: string
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`rfqsend:${session.userId}`, SEND_RATE_MAX)) {
    return { ok: false, error: "Please wait a moment and try again." };
  }
  const r = await sendFreightRfqCore(shipmentId, session.userId, carrierEmail, subject, body);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.audited) return { ok: true, warning: "Email sent, but logging it failed — please flag this." };
  return { ok: true };
}

"use server";

import { createHash } from "crypto";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { draftFreightRfq, draftCounterOffer, type FreightRfq } from "@/lib/ai/freight-agent";
import { sendFreightRfqCore } from "@/lib/freight/send-rfq";
import { parseFreightQuote } from "@/lib/ai/parse-freight-quote";

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

// Draft a counter-offer to a carrier whose quote the exporter chose to negotiate.
// Uses the negotiate target (x0.985) recorded at the G4 gate. Draft only; the
// operator sends it via sendFreightRfqAction (the audited send path).
export async function draftCounterAction(
  shipmentId: string,
  quoteId: string
): Promise<{ ok: true; draft: FreightRfq } | { ok: false; error: string }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`counter:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };

  const admin = createSupabaseServerClient();
  const { data: q } = await admin
    .from("freight_quotes")
    .select("carrier_name, rate_amount, rate_currency, negotiate_target, decision")
    .eq("id", quoteId)
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  if (!q) return { ok: false, error: "Quote not found." };
  if (q.decision !== "negotiate") return { ok: false, error: "This quote isn't being negotiated." };

  const { data: ship } = await admin
    .from("shipments")
    .select("reference_number")
    .eq("id", shipmentId)
    .maybeSingle();

  const cur = ((q.rate_currency as string) ?? "").trim();
  const draft = await draftCounterOffer({
    reference: (ship?.reference_number as string) ?? "",
    carrierName: ((q.carrier_name as string) ?? "").trim(),
    currentRate: q.rate_amount != null ? `${cur} ${q.rate_amount}`.trim() : "",
    targetRate: q.negotiate_target != null ? `${cur} ${q.negotiate_target}`.trim() : "",
  });
  if (!draft) return { ok: false, error: "Couldn't draft the counter — try again." };
  return { ok: true, draft };
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

// Parse a carrier's quote reply into a structured quote and store it. The agent
// extracts only what the carrier stated (never invents a rate); the operator
// pastes the reply for now (auto-inbound is a later build).
export async function addFreightQuoteAction(
  shipmentId: string,
  rawText: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`rfqparse:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (!rawText.trim()) return { ok: false, error: "Paste the carrier's reply first." };

  const parsed = await parseFreightQuote(rawText);
  if (!parsed) return { ok: false, error: "Couldn't read a quote from that reply." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin.from("shipments").select("id").eq("id", shipmentId).maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const { error } = await admin.from("freight_quotes").insert({
    shipment_id: shipmentId,
    carrier_name: parsed.carrierName || null,
    rate_amount: parsed.rateAmount,
    rate_currency: parsed.rateCurrency || null,
    transit_days: parsed.transitDays,
    free_days: parsed.freeDays,
    surcharges: parsed.surcharges || null,
    validity: parsed.validity || null,
    raw_text: rawText.slice(0, 4000),
    created_by: session.userId,
  });
  if (error) {
    console.error("freight_quote_insert_failed", { shipmentId });
    return { ok: false, error: "Couldn't save the quote — try again." };
  }

  // Audit the quote-add — it feeds the G4 carrier (money) decision, so it leaves a
  // human-readable trace: who added it, which carrier, a hash of the raw reply.
  const rawHash = createHash("sha256").update(rawText.slice(0, 4000)).digest("hex");
  const { error: auditErr } = await admin.from("audit_operator_action").insert({
    operator_id: session.userId,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "freight_quote_added", carrier_name: parsed.carrierName || null, raw_sha256: rawHash },
  });
  if (auditErr) console.error("freight_quote_audit_write_failed", { shipmentId });

  return { ok: true };
}

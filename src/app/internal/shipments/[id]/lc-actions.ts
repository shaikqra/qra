"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkLcDiscrepancies, type LcDiscrepancy } from "@/lib/ai/lc-check";
import { DOC_LABELS } from "@/lib/docs/send-to-cha-core";

type LcResult = { ok: true; discrepancies: LcDiscrepancy[] } | { ok: false; error: string };

// Per-operator throttle (in-memory) — LC checks are heavier calls; keep it tight.
const RATE_MAX = 5;
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

// LC / UCP-600 discrepancy check. The operator pastes the LC terms; the agent
// compares them against the shipment's document data. Advisory; nothing stored.
export async function checkLcAction(shipmentId: string, lcText: string): Promise<LcResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`lc:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };
  if (!lcText.trim()) return { ok: false, error: "Paste the LC terms first." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("customer_id, extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const d = (ship.extracted_data ?? {}) as Record<string, string>;
  const g = (k: string) => (d[k] ?? "").trim();

  // The exporter (LC beneficiary) name comes from their profile, not the PO.
  const { data: profile } = await admin
    .from("exporter_profiles")
    .select("legal_name")
    .eq("customer_id", ship.customer_id)
    .maybeSingle();
  const beneficiary = ((profile?.legal_name as string) ?? "").trim();

  // Computed here (not by the model) so the DATES check has a fixed "now".
  // IST (UTC+5:30) — a UTC date is a day behind before 5:30am for Indian users.
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

  // The documents Qra has generated for this shipment (latest set), by type. The
  // examiner compares this against the LC's required-documents clause. We also pull
  // the most recent commercial invoice's generation date to pass as "Invoice date".
  const { data: gdocs } = await admin
    .from("generated_documents")
    .select("doc_type, generated_at")
    .eq("shipment_id", shipmentId)
    .order("generated_at", { ascending: false });
  const generatedTypes = new Set<string>();
  let invoiceDate = "";
  for (const row of (gdocs ?? []) as { doc_type: string; generated_at: string }[]) {
    // The cover letter is built FROM this list — it never presents itself.
    if (row.doc_type === "lc_cover_letter") continue;
    generatedTypes.add(row.doc_type);
    if (!invoiceDate && row.doc_type === "commercial_invoice") {
      invoiceDate = String(row.generated_at ?? "").slice(0, 10);
    }
  }
  // "(none generated yet)" so the model can tell an empty list from a missing one.
  const generatedDocNames =
    [...generatedTypes].map((t) => DOC_LABELS[t] ?? t).join(", ") || "(none generated yet)";

  const facts = [
    ["Today's date", today],
    ["Beneficiary (exporter)", beneficiary],
    ["Applicant / buyer (the invoice is addressed to this party)", g("buyer_name")],
    ["Goods description", g("product_description")],
    ["Quantity", [g("quantity"), g("quantity_unit")].filter(Boolean).join(" ")],
    ["Amount", [g("value_currency"), g("value_amount")].filter(Boolean).join(" ")],
    ["Incoterm", g("incoterm")],
    ["HS code", g("hs_code")],
    ["Port of loading", g("port_of_loading")],
    ["Port of discharge", g("port_of_discharge")],
    ["Net weight", g("net_weight")],
    ["Gross weight", g("gross_weight")],
    ["Number of packages", g("number_of_packages")],
    ["Invoice date (most recent commercial invoice generated)", invoiceDate],
    ["Documents Qra has generated for this shipment", generatedDocNames],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const checked = await checkLcDiscrepancies(lcText, facts);
  if (!checked) return { ok: false, error: "Couldn't run the LC check — try again." };
  const { discrepancies, meta } = checked;

  // Persist so the exporter's Treasury card lights up and the LC review surfaces
  // in their console — a clean presentation is what releases their payment.
  // Stored under the reserved "_lc" key (doc generators read named fields only);
  // "_lc_meta" carries the LC's own identifying details (number, issuing bank,
  // applicant) so the cover-letter generator can build the bank presentation.
  // Atomic merge under the row lock — the AI call above is slow enough for a
  // concurrent write (gap-fill reply, tracking update) to land, and the old
  // read-modify-write would silently erase it. Only the two _lc keys are set.
  await admin.rpc("merge_extracted_data", {
    p_shipment_id: shipmentId,
    p_patch: {
      _lc: JSON.stringify({ count: discrepancies.length, discrepancies }),
      _lc_meta: JSON.stringify(meta),
    },
  });
  await admin.from("audit_operator_action").insert({
    operator_id: session.userId,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "lc_checked", discrepancies: discrepancies.length }, // count only, no PII
  });

  return { ok: true, discrepancies };
}

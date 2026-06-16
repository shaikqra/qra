"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkLcDiscrepancies, type LcDiscrepancy } from "@/lib/ai/lc-check";

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

  const facts = [
    ["Beneficiary (exporter)", beneficiary],
    ["Applicant / consignee (buyer)", g("buyer_name")],
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
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const discrepancies = await checkLcDiscrepancies(lcText, facts);
  if (!discrepancies) return { ok: false, error: "Couldn't run the LC check — try again." };
  return { ok: true, discrepancies };
}

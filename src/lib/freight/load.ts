import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rankFreightQuotes, type RankedQuotes } from "./rank-quotes";

// Load a shipment's carrier quotes and rank them. freight_quotes is RLS
// default-deny, so this must use the service-role admin client; callers
// (operator page behind ensureOperator, portal page scoped by token) are
// responsible for authorizing the shipmentId before calling.
export async function loadRankedFreight(
  admin: ReturnType<typeof createSupabaseServerClient>,
  shipmentId: string
): Promise<RankedQuotes> {
  const { data } = await admin
    .from("freight_quotes")
    .select(
      "id, carrier_name, rate_amount, rate_currency, transit_days, free_days, surcharges, validity, decision, negotiate_target"
    )
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as Array<{
    id: string;
    carrier_name: string | null;
    rate_amount: number | string | null;
    rate_currency: string | null;
    transit_days: number | null;
    free_days: number | null;
    surcharges: string | null;
    validity: string | null;
    decision: string | null;
    negotiate_target: number | string | null;
  }>;

  return rankFreightQuotes(
    rows.map((r) => ({
      id: r.id,
      carrierName: r.carrier_name ?? "",
      rateAmount: r.rate_amount == null ? null : Number(r.rate_amount),
      rateCurrency: r.rate_currency ?? "",
      transitDays: r.transit_days,
      freeDays: r.free_days,
      surcharges: r.surcharges ?? "",
      validity: r.validity ?? "",
      decision: r.decision ?? "",
      negotiateTarget: r.negotiate_target == null ? null : Number(r.negotiate_target),
    }))
  );
}

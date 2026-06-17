import { ensureOperator } from "../layout";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TradeGraphReview, type DraftRule } from "./review";

export const dynamic = "force-dynamic";

// The analyst's Trade Graph desk: AI-drafted lane rules waiting to be verified once
// (with their source). The table is RLS default-deny, so read it with the
// service-role client behind the operator gate.
export default async function TradeGraphPage() {
  await ensureOperator();

  const admin = createSupabaseServerClient();
  const { data: drafts } = await admin
    .from("trade_graph_rules")
    .select("id, rule_type, lane_key, payload, created_at")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(200);
  const { count } = await admin
    .from("trade_graph_rules")
    .select("id", { count: "exact", head: true })
    .eq("status", "verified");

  return <TradeGraphReview drafts={(drafts ?? []) as DraftRule[]} verifiedCount={count ?? 0} />;
}

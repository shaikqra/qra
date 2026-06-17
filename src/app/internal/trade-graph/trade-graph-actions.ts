"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

// Analyst verifies a draft Trade Graph rule: flips it to 'verified' with a citation
// (the source it traces to — a notification / circular / regulation). One verified
// rule per lane is DB-enforced. From then on every shipment on that lane uses it
// instantly, cited — the moat compounding.
export async function verifyTradeGraphRule(ruleId: string, citation: string): Promise<Result> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  const cite = citation.trim();
  if (!cite) {
    return { ok: false, error: "Add the source this rule traces to (a notification / circular / regulation) first." };
  }

  const admin = createSupabaseServerClient();
  const { data: updated, error } = await admin
    .from("trade_graph_rules")
    .update({
      status: "verified",
      citation: cite.slice(0, 500),
      verified_by: session.userId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    // Most likely the one-verified-per-lane unique index.
    return { ok: false, error: "Couldn't verify — a verified rule may already exist for this lane." };
  }
  if (!updated || updated.length === 0) return { ok: true }; // already verified/gone

  revalidatePath("/internal/trade-graph");
  return { ok: true };
}

// Analyst rejects a wrong AI draft — removes it so it can be re-drafted fresh next
// time a shipment on that lane runs.
export async function rejectTradeGraphRule(ruleId: string): Promise<Result> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  const admin = createSupabaseServerClient();
  await admin.from("trade_graph_rules").delete().eq("id", ruleId).eq("status", "draft");
  revalidatePath("/internal/trade-graph");
  return { ok: true };
}

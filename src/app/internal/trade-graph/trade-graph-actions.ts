"use server";

import { revalidatePath } from "next/cache";
import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

// Sanitize the analyst's curated cert list before it lands in the SHARED Trade
// Graph: strings only, length + count capped, blank-name rows dropped. Never trust
// client-shaped JSON into global data.
function sanitizeCerts(payload: unknown): { name: string; note: string; issuedBy: string }[] {
  if (!Array.isArray(payload)) return [];
  const out: { name: string; note: string; issuedBy: string }[] = [];
  for (const c of payload.slice(0, 20)) {
    const o = (c ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? "").trim().slice(0, 120);
    if (!name) continue;
    out.push({
      name,
      note: String(o.note ?? "").trim().slice(0, 300),
      issuedBy: String((o.issuedBy ?? o.issued_by) ?? "").trim().slice(0, 120),
    });
  }
  return out;
}

// Analyst verifies a draft Trade Graph rule: saves their (possibly edited) cert list
// + a citation (the source it traces to — a notification / circular / regulation)
// and flips it to 'verified'. One verified rule per lane is DB-enforced. From then on
// every shipment on that lane uses it instantly, cited — the moat compounding.
export async function verifyTradeGraphRule(ruleId: string, citation: string, payload: unknown): Promise<Result> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  const cite = citation.trim();
  if (!cite) {
    return { ok: false, error: "Add the source this rule traces to (a notification / circular / regulation) first." };
  }
  const certs = sanitizeCerts(payload);
  if (certs.length === 0) {
    return { ok: false, error: "Keep at least one certificate (with a name) before verifying." };
  }

  const admin = createSupabaseServerClient();
  const { data: updated, error } = await admin
    .from("trade_graph_rules")
    .update({
      status: "verified",
      payload: certs,
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

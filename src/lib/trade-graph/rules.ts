import { createSupabaseServerClient } from "@/lib/supabase/server";

// The Trade Graph: export rules as data, cited and version-pinned. Agents read a
// VERIFIED rule for a lane (instant, cited, no model call); a miss is AI-drafted
// and queued for an analyst to verify once — then it's instant forever.

export type RuleStatus = "draft" | "verified";

export type TradeGraphRule<T = unknown> = {
  id: string;
  ruleType: string;
  laneKey: string;
  payload: T;
  citation: string | null;
  status: RuleStatus;
  version: number;
};

// Common country-name variants → one canonical name, so two POs to the same place
// land on the SAME lane (otherwise the verified rule is never reused and the moat
// never compounds). Not exhaustive — covers the frequent ones; anything else falls
// through to its trimmed lowercase form (still consistent for identical inputs).
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "u.s.": "united states",
  "u.s.a.": "united states",
  "united states of america": "united states",
  america: "united states",
  uk: "united kingdom",
  "u.k.": "united kingdom",
  britain: "united kingdom",
  "great britain": "united kingdom",
  england: "united kingdom",
  uae: "united arab emirates",
  "u.a.e.": "united arab emirates",
  holland: "netherlands",
  "the netherlands": "netherlands",
  nl: "netherlands",
  deutschland: "germany",
  ksa: "saudi arabia",
  saudi: "saudi arabia",
  prc: "china",
};

function normalizeDestination(destination: string): string {
  const d = destination.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,]+$/, "");
  return COUNTRY_ALIASES[d] ?? d;
}

// A lane = destination + product family (HS HEADING = first 4 HS digits).
// Cert/duty/doc rules are largely a function of (where it's going, what it is).
// Heading not chapter (2 digits): a chapter is too broad — different products in one
// chapter can need different certs, and a VERIFIED rule is served as authoritative
// with no model call, so accuracy beats moat-accumulation speed here. Destination is
// canonicalized so "USA"/"United States" don't split into two lanes.
export function laneKey(destination: string, hsCode: string): string {
  const dest = normalizeDestination(destination);
  const digits = hsCode.replace(/\D/g, "");
  const heading = digits.length >= 4 ? digits.slice(0, 4) : "xxxx";
  return `${dest}|hs${heading}`;
}

function rowToRule<T>(r: {
  id: string;
  rule_type: string;
  lane_key: string;
  payload: unknown;
  citation: string | null;
  status: string;
  version: number;
}): TradeGraphRule<T> {
  return {
    id: r.id,
    ruleType: r.rule_type,
    laneKey: r.lane_key,
    payload: r.payload as T,
    citation: r.citation,
    status: r.status as RuleStatus,
    version: r.version,
  };
}

// The authoritative (verified) rule for a lane, if one exists.
export async function getVerifiedRule<T>(ruleType: string, lane: string): Promise<TradeGraphRule<T> | null> {
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("trade_graph_rules")
    .select("id, rule_type, lane_key, payload, citation, status, version")
    .eq("rule_type", ruleType)
    .eq("lane_key", lane)
    .eq("status", "verified")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? rowToRule<T>(data) : null;
}

// Store an AI-drafted rule for an analyst to verify later. No-op if the lane
// already has any rule (draft or verified) — we don't pile up duplicate drafts.
// ⚠️ payload is GLOBAL / shared across customers — never store customer-specific
// text in it (no buyer names, addresses, values). Keep it lane-generic.
export async function storeDraftRule(ruleType: string, lane: string, payload: unknown): Promise<void> {
  const admin = createSupabaseServerClient();
  const { data: existing } = await admin
    .from("trade_graph_rules")
    .select("id")
    .eq("rule_type", ruleType)
    .eq("lane_key", lane)
    .limit(1)
    .maybeSingle();
  if (existing) return;
  const { error } = await admin
    .from("trade_graph_rules")
    .insert({ rule_type: ruleType, lane_key: lane, payload, status: "draft" });
  // A unique violation (23505) means a concurrent run already drafted this exact
  // lane — that's the outcome we want (one draft per lane), so ignore it. Any
  // other error is real and worth a (PII-free) log.
  if (error && error.code !== "23505") {
    console.error("store_draft_rule_failed", { code: error.code });
  }
}

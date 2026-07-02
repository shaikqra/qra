"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredDocuments, type RequiredDoc } from "@/lib/ai/required-docs-agent";

type DocsResult = { ok: true; docs: RequiredDoc[] } | { ok: false; error: string };

// Best-effort per-operator throttle (in-memory) — caps paid AI bursts.
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

// Required-Documents agent — list the extra documents this shipment likely needs
// beyond Qra's standard set. Advisory; reads the shipment's product + destination
// + HS code.
export async function checkRequiredDocsAction(shipmentId: string): Promise<DocsResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`docs:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const d = (ship.extracted_data ?? {}) as Record<string, string>;
  const g = (k: string) => (d[k] ?? "").trim();

  const docs = await requiredDocuments(g("product_description"), g("destination_country"), g("hs_code"));
  if (!docs) return { ok: false, error: "Couldn't check documents — add a product description first." };

  // Persist so the exporter sees it too (same store + shape the auto-run agent
  // uses, so docs-list.tsx renders consistent draft framing on this path too).
  await admin
    .from("shipments")
    .update({
      extracted_data: { ...d, _required_docs: JSON.stringify(docs), _required_docs_source: "draft", _required_docs_citation: "" },
    })
    .eq("id", shipmentId);

  return { ok: true, docs };
}

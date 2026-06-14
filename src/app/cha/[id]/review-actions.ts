"use server";

import { getChaSession } from "@/lib/supabase/cha-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { reviewDocuments, type DocReviewFlag } from "@/lib/ai/review-documents";

type Result = { ok: true; flags: DocReviewFlag[] } | { ok: false; error: string };

// Best-effort per-broker rate limit — each check is a paid model call, so cap
// how fast one signed-in broker can fire them (cost-bomb guard). Per-instance
// (not shared across serverless instances); move to a shared store if this ever
// sees heavy traffic.
const RATE_MAX = 15;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (rateBuckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    rateBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return false;
}

// On-demand AI document check for the broker. The RLS read returns nothing if
// the shipment isn't one of this broker's, so a broker can only check their own.
export async function runDocumentReview(shipmentId: string): Promise<Result> {
  const session = await getChaSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(session.userId)) {
    return { ok: false, error: "Too many checks — wait a moment and try again." };
  }

  const supabase = await createSupabaseAuthClient();
  const { data } = await supabase
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Shipment not found" };

  // Coerce every value to a string for the checks (extracted_data is jsonb).
  const extracted: Record<string, string> = {};
  for (const [k, v] of Object.entries((data.extracted_data ?? {}) as Record<string, unknown>)) {
    extracted[k] = v == null ? "" : String(v);
  }

  try {
    const flags = await reviewDocuments(extracted);
    return { ok: true, flags };
  } catch (e) {
    console.error("runDocumentReview_failed", e instanceof Error ? e.name : "unknown");
    return { ok: false, error: "Could not run the check — please try again." };
  }
}

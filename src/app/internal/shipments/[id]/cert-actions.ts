"use server";

import { getOperatorSession } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredCertificates, type RequiredCert } from "@/lib/ai/certification-agent";

type CertResult = { ok: true; certs: RequiredCert[] } | { ok: false; error: string };

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

// Certification agent — list the certificates this shipment likely needs.
// Advisory; reads the shipment's product + destination + HS code.
export async function checkRequiredCertsAction(shipmentId: string): Promise<CertResult> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  if (rateLimited(`certs:${session.userId}`)) return { ok: false, error: "Please wait a moment and try again." };

  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return { ok: false, error: "Shipment not found." };

  const d = (ship.extracted_data ?? {}) as Record<string, string>;
  const g = (k: string) => (d[k] ?? "").trim();

  const certs = await requiredCertificates(g("product_description"), g("destination_country"), g("hs_code"));
  if (!certs) return { ok: false, error: "Couldn't check certificates — add a product description first." };

  // Persist so the exporter sees it too (same store + shape the auto-run agent
  // uses, so cert-list.tsx renders consistent draft framing on this path too).
  // Atomic merge of just the reserved cert keys — every other key is preserved.
  await admin.rpc("merge_extracted_data", {
    p_shipment_id: shipmentId,
    p_patch: { _certifications: JSON.stringify(certs), _certifications_source: "draft", _certifications_citation: "" },
  });

  return { ok: true, certs };
}

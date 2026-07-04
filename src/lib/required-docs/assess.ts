import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredDocuments, type RequiredDoc } from "@/lib/ai/required-docs-agent";
import { laneKey, getVerifiedRule, storeDraftRule } from "@/lib/trade-graph/rules";

// Run the Required-Documents agent on a shipment and STORE the result for the
// exporter. Trade Graph first: if a VERIFIED rule exists for this lane (destination
// + HS heading) it's used as-is — instant, cited, no model call. On a miss, the AI
// drafts the list, the draft is queued in the Trade Graph for an analyst to verify
// once, and the draft is used for now. Stored under reserved keys in extracted_data
// (doc generators read named fields only, so this never leaks onto a document).
// Advisory + best-effort: missing data or any failure leaves the shipment unchanged
// and never blocks document generation. Mirrors assessCertificationsCore exactly.
export async function assessRequiredDocsCore(shipmentId: string): Promise<void> {
  const admin = createSupabaseServerClient();
  const { data: ship } = await admin
    .from("shipments")
    .select("extracted_data")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship) return;

  const d = (ship.extracted_data ?? {}) as Record<string, string>;
  const g = (k: string) => (d[k] ?? "").trim();
  if (!g("product_description") || !g("destination_country")) return;

  const lane = laneKey(g("destination_country"), g("hs_code"));

  // Same gating as certs: only trust an authoritative verified rule when we have a
  // real 4-digit HS heading. Without an HS code the lane collapses to a generic
  // "hsxxxx" placeholder shared by every HS-less shipment to this destination, so a
  // verified rule there could belong to an unrelated product — fall through to the
  // per-product AI draft instead.
  const hasHsHeading = g("hs_code").replace(/\D/g, "").length >= 4;

  let docs: RequiredDoc[] | null = null;
  let source: "verified" | "draft" = "draft";
  let citation = "";

  // Trade Graph: a verified rule for this lane is the authoritative, cited answer.
  const verified = hasHsHeading
    ? await getVerifiedRule<RequiredDoc[]>("required_docs", lane)
    : null;
  if (verified && Array.isArray(verified.payload) && verified.payload.length > 0) {
    docs = verified.payload;
    source = "verified";
    citation = verified.citation ?? "";
  } else {
    docs = await requiredDocuments(g("product_description"), g("destination_country"), g("hs_code"));
    if (docs && docs.length > 0) {
      // Queue this lane's draft for an analyst to verify once → instant forever.
      await storeDraftRule("required_docs", lane, docs);
    }
  }
  if (!docs || docs.length === 0) return;

  // Atomic shallow merge under the row lock — the model call above is slow enough
  // for a concurrent write (a gap-fill reply, another agent) to land, and the old
  // read-modify-write would silently erase it. Only the reserved doc keys are set;
  // every other key is preserved by the merge.
  await admin.rpc("merge_extracted_data", {
    p_shipment_id: shipmentId,
    p_patch: {
      _required_docs: JSON.stringify(docs),
      _required_docs_source: source,
      _required_docs_citation: citation,
    },
  });

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "required_docs_assessed", count: docs.length, source, lane },
  });
}

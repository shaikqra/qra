import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredCertificates, type RequiredCert } from "@/lib/ai/certification-agent";
import { laneKey, getVerifiedRule, storeDraftRule } from "@/lib/trade-graph/rules";

// Run the Certification agent on a shipment and STORE the result for the exporter.
// Trade Graph first: if a VERIFIED rule exists for this lane (destination + HS
// chapter) it's used as-is — instant, cited, no model call. On a miss, the AI
// drafts the list, the draft is queued in the Trade Graph for an analyst to verify
// once, and the draft is used for now. Stored under reserved keys in extracted_data
// (doc generators read named fields only, so this never leaks onto a document).
// Advisory + best-effort: missing data or any failure leaves the shipment unchanged
// and never blocks document generation.
export async function assessCertificationsCore(shipmentId: string): Promise<void> {
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

  let certs: RequiredCert[] | null = null;
  let source: "verified" | "draft" = "draft";
  let citation = "";

  // Trade Graph: a verified rule for this lane is the authoritative, cited answer.
  const verified = await getVerifiedRule<RequiredCert[]>("required_certs", lane);
  if (verified && Array.isArray(verified.payload) && verified.payload.length > 0) {
    certs = verified.payload;
    source = "verified";
    citation = verified.citation ?? "";
  } else {
    certs = await requiredCertificates(g("product_description"), g("destination_country"), g("hs_code"));
    if (certs && certs.length > 0) {
      // Queue this lane's draft for an analyst to verify once → instant forever.
      await storeDraftRule("required_certs", lane, certs);
    }
  }
  if (!certs || certs.length === 0) return;

  await admin
    .from("shipments")
    .update({
      extracted_data: {
        ...d,
        _certifications: JSON.stringify(certs),
        _certifications_source: source,
        _certifications_citation: citation,
      },
    })
    .eq("id", shipmentId);

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "certificates_assessed", count: certs.length, source, lane },
  });
}

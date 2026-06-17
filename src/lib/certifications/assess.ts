import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredCertificates } from "@/lib/ai/certification-agent";

// Run the Certification agent on a shipment and STORE the result, so it persists
// and surfaces to the exporter (not just an operator's transient check). Stored
// under the reserved `_certifications` key in extracted_data — the doc generators
// read named fields only, so this never leaks onto a document. Advisory + best-
// effort: missing data or any failure leaves the shipment unchanged (it never
// blocks document generation). generatedBy is recorded on the audit note.
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
  // Needs at least the product + destination to say anything useful.
  if (!g("product_description") || !g("destination_country")) return;

  const certs = await requiredCertificates(g("product_description"), g("destination_country"), g("hs_code"));
  if (!certs || certs.length === 0) return;

  await admin
    .from("shipments")
    .update({ extracted_data: { ...d, _certifications: JSON.stringify(certs) } })
    .eq("id", shipmentId);

  await admin.from("audit_operator_action").insert({
    operator_id: null,
    shipment_id: shipmentId,
    action_type: "note",
    old_value: null,
    new_value: { event: "certificates_assessed", count: certs.length },
  });
}

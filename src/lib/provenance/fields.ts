import { readDraftedFields } from "@/lib/docs/verify-gate";

// Per-field provenance (Build Bible §8.1: "per-field provenance"). Shows where every
// value on the documents came from — the exporter's saved profile, their PO, a Qra
// draft, or a profile default. The trust story: Qra invents nothing; every value
// traces to a source.

export type FieldSource = "profile" | "po" | "draft" | "default";
export type ProvenanceRow = { label: string; value: string; source: FieldSource };

export function documentProvenance(
  extracted: Record<string, string>,
  profile: Record<string, string>
): ProvenanceRow[] {
  const d = (k: string) => (extracted[k] ?? "").trim();
  const p = (k: string) => (profile[k] ?? "").trim();
  const drafted = new Set(readDraftedFields(extracted));

  const incoterm = d("incoterm") || p("default_incoterm");

  const rows: (ProvenanceRow | null)[] = [
    // Exporter identity — from the saved profile.
    p("legal_name") ? { label: "Exporter", value: p("legal_name"), source: "profile" } : null,
    p("iec") ? { label: "IEC", value: p("iec"), source: "profile" } : null,
    p("gstin") ? { label: "GSTIN", value: p("gstin"), source: "profile" } : null,
    // Order — read off the PO.
    d("buyer_name") ? { label: "Buyer", value: d("buyer_name"), source: "po" } : null,
    d("product_description") ? { label: "Goods", value: d("product_description"), source: "po" } : null,
    d("quantity") ? { label: "Quantity", value: `${d("quantity")} ${d("quantity_unit")}`.trim(), source: "po" } : null,
    d("value_amount")
      ? { label: "Value", value: `${d("value_currency")} ${d("value_amount")}`.trim(), source: "po" }
      : null,
    d("destination_country") ? { label: "Destination", value: d("destination_country"), source: "po" } : null,
    // Incoterm — off the PO if stated, else the profile default.
    incoterm ? { label: "Incoterm", value: incoterm.toUpperCase(), source: d("incoterm") ? "po" : "default" } : null,
    // HS code — a Qra draft (to confirm) or read off the PO.
    d("hs_code") ? { label: "HS code", value: d("hs_code"), source: drafted.has("hs_code") ? "draft" : "po" } : null,
  ];

  return rows.filter((r): r is ProvenanceRow => r !== null);
}

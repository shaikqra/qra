// The fields a shipment must have before the auto-generated documents
// (commercial invoice + packing list) can be produced. Mirrors the required
// lists in lib/docs/generate.ts — keep in sync if those change.
// Only the fields a buyer's PO actually carries are required to generate the
// documents. Packing details (packages, weights) are the exporter's facts, vary
// by format, and rarely appear on a PO — so they are NOT required here; the docs
// generate with whatever's present and the packing fields are filled later.
export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  buyer_name: "Buyer name",
  product_description: "Product description",
  quantity: "Quantity",
  value_amount: "Invoice value",
  value_currency: "Currency",
};

export function missingRequiredFields(extracted: Record<string, string>): string[] {
  return Object.keys(REQUIRED_FIELD_LABELS).filter(
    (k) => !(extracted[k] ?? "").trim()
  );
}

export function labelsFor(keys: string[]): string[] {
  return keys.map((k) => REQUIRED_FIELD_LABELS[k] ?? k);
}

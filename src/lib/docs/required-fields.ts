// The fields a shipment must have before the auto-generated documents
// (commercial invoice + packing list) can be produced. Mirrors the required
// lists in lib/docs/generate.ts — keep in sync if those change.
export const REQUIRED_FIELD_LABELS: Record<string, string> = {
  buyer_name: "Buyer name",
  product_description: "Product description",
  quantity: "Quantity",
  value_amount: "Invoice value",
  value_currency: "Currency",
  number_of_packages: "Number of packages",
  package_type: "Package type (cartons, bags...)",
  net_weight: "Net weight",
  gross_weight: "Gross weight",
};

export function missingRequiredFields(extracted: Record<string, string>): string[] {
  return Object.keys(REQUIRED_FIELD_LABELS).filter(
    (k) => !(extracted[k] ?? "").trim()
  );
}

export function labelsFor(keys: string[]): string[] {
  return keys.map((k) => REQUIRED_FIELD_LABELS[k] ?? k);
}

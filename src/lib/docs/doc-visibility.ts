// Broker-facing documents that the EXPORTER should never receive — neither on
// WhatsApp nor in the portal. The Shipping Bill Data Sheet is internal filing
// data for the CHA only. Single source of truth so the WhatsApp send path and
// the exporter portal can't drift apart.
export const NOT_FOR_CUSTOMER = new Set<string>(["shipping_bill_pack"]);

export function isExporterVisibleDoc(docType: string): boolean {
  return !NOT_FOR_CUSTOMER.has(docType);
}

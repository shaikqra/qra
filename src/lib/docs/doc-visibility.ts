// Documents the EXPORTER should never receive — neither on WhatsApp nor in the
// portal. Single source of truth so the WhatsApp send path and the exporter
// portal can't drift apart. Currently empty: the exporter sees their full pack,
// including the Shipping Bill checklist (the data sheet the CHA files). Add a
// doc_type here if a future document is genuinely broker-only.
export const NOT_FOR_CUSTOMER = new Set<string>([]);

export function isExporterVisibleDoc(docType: string): boolean {
  return !NOT_FOR_CUSTOMER.has(docType);
}

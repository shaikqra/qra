// The exporter-facing journey, mapped from our internal shipment statuses to a
// small, plain-English set of stages. Only the stages the product ACTUALLY
// drives are here — no fabricated freight/LC/tracking steps (honest by design).
export type PortalStage = { key: string; label: string };

export const PORTAL_STAGES: PortalStage[] = [
  { key: "received", label: "Order received" },
  { key: "prepared", label: "Documents prepared" },
  { key: "approval", label: "Your approval" },
  { key: "cha", label: "Sent to your CHA" },
  { key: "shipped", label: "Shipped" },
  { key: "complete", label: "Complete" },
];

// Index into PORTAL_STAGES for a raw status. Returns -1 for a stopped shipment.
export function portalStageIndex(status: string): number {
  switch (status) {
    case "po_received":
    case "data_extracting":
    case "awaiting_order_confirm":
      return 0;
    case "awaiting_customer_info":
    case "awaiting_customer_verify":
    case "generating_documents":
    case "sanctions_screening":
    case "bucket_b_review":
      return 1;
    case "awaiting_customer_approval":
    case "awaiting_goods_ready":
      return 2;
    case "customer_approved":
    case "filed_with_cha":
      return 3;
    case "customs_cleared":
    case "in_transit":
    case "delivered":
      return 4;
    case "completed":
      return 5;
    case "rejected":
    case "order_declined":
      return -1;
    default:
      return 0;
  }
}

// A short prompt when the shipment is waiting on the EXPORTER (actions live on
// WhatsApp — the portal is read-only, so it points them back there).
export function portalActionHint(status: string): string | null {
  switch (status) {
    case "awaiting_order_confirm":
      return "Waiting for you to confirm this order.";
    case "awaiting_customer_info":
      // Gap-fill needs a free-text reply — that still happens on WhatsApp.
      return "We need a few more details — reply on WhatsApp.";
    case "awaiting_customer_verify":
      return "Please check a couple of details — confirm below, or reply on WhatsApp to correct.";
    case "awaiting_customer_approval":
      return "Your documents are ready to review and approve.";
    case "awaiting_goods_ready":
      return "Confirm your goods are ready to ship — we'll then send everything to your CHA.";
    default:
      return null;
  }
}

export function portalStopped(status: string): boolean {
  return status === "rejected" || status === "order_declined";
}

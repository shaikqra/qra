// The exporter console's "agent cards" (Build Bible §line 545) — an HONEST,
// derived view of which agents have acted on THIS shipment and their current
// state. Driven by the real shipment status (+ a freight signal), never a
// decorative simulation: only agents that genuinely act in the live backend
// appear, and "compliance" wording stays vague (anti-tipping-off, per screening).

export type AgentState = "done" | "working" | "pending" | "review";
export type AgentCard = { key: string; name: string; icon: string; state: AgentState; note: string };

// Lifecycle position of each status — the order agents act in.
const STAGE: Record<string, number> = {
  po_received: 0,
  data_extracting: 1,
  awaiting_order_confirm: 2,
  awaiting_customer_verify: 2,
  awaiting_customer_info: 2,
  sanctions_screening: 3,
  generating_documents: 4,
  bucket_b_review: 4,
  awaiting_customer_approval: 5,
  customer_approved: 6,
  filed_with_cha: 7,
  customs_cleared: 8,
  in_transit: 9,
  delivered: 10,
  completed: 11,
};

type Spec = { key: string; name: string; icon: string; at: number; working: string; done: string; pending: string };

// Only the agents that really run in the live backend. Compliance copy is
// deliberately vague — the exporter never sees "sanctions".
const CORE: Spec[] = [
  { key: "intake", name: "Reading agent", icon: "🤖", at: 1, working: "Reading your PO…", done: "Read your PO", pending: "Will read your PO" },
  { key: "compliance", name: "Compliance agent", icon: "🛡️", at: 3, working: "Running compliance checks…", done: "Compliance checks passed", pending: "Will run compliance checks" },
  { key: "documents", name: "Documents agent", icon: "📄", at: 4, working: "Drafting your documents…", done: "Drafted your documents", pending: "Will draft your documents" },
  { key: "filing", name: "Filing agent", icon: "📧", at: 6, working: "Sending to your CHA…", done: "Sent to your CHA", pending: "Will send to your CHA" },
];

export function agentFleet(
  status: string,
  freight: { pending: boolean; awarded: boolean }
): AgentCard[] {
  const idx = STAGE[status] ?? 0;
  const cards: AgentCard[] = CORE.map((a) => {
    const state: AgentState = idx < a.at ? "pending" : idx === a.at ? "working" : "done";
    const note = state === "working" ? a.working : state === "done" ? a.done : a.pending;
    return { key: a.key, name: a.name, icon: a.icon, state, note };
  });

  // Freight only appears when there are real quotes on the shipment.
  if (freight.awarded) {
    cards.push({ key: "freight", name: "Freight agent", icon: "🚢", state: "done", note: "Carrier awarded" });
  } else if (freight.pending) {
    cards.push({ key: "freight", name: "Freight agent", icon: "🚢", state: "working", note: "Quotes ready — needs your decision" });
  }

  // Honest about the human fallback: a flagged shipment is being handled by a
  // person, not silently "working".
  if (status === "bucket_b_review") {
    return cards.map((c) =>
      c.state === "working" ? { ...c, state: "review", note: "Our team is reviewing this step" } : c
    );
  }

  return cards;
}

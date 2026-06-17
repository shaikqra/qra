// The exporter console's "agent cards" (Build Bible §line 545) — the FULL 9-agent
// fleet (line 86) shown in lifecycle order, with HONEST per-agent state. Agents
// that run in the live backend advance done → working → pending; capabilities that
// come later in the journey (or aren't automated yet) show greyed as "later".
// Never a decorative "9 agents humming": state is derived from the real shipment
// status, and "compliance" copy stays vague (anti-tipping-off, per screening).

export type AgentState = "done" | "working" | "pending" | "review" | "later";
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
  awaiting_goods_ready: 5,
  customer_approved: 6,
  filed_with_cha: 7,
  customs_cleared: 8,
  in_transit: 9,
  delivered: 10,
  completed: 11,
};

// The 9 agents in lifecycle order. "core" agents run automatically and advance
// with the shipment; "later" agents are capabilities for later in the journey or
// on request (shown, but honestly greyed — they don't auto-run today).
type Spec =
  | { kind: "core"; key: string; name: string; icon: string; at: number; working: string; done: string; pending: string }
  | { kind: "later"; key: string; name: string; icon: string; note: string };

const FLEET: Spec[] = [
  { kind: "core", key: "intake", name: "Reading agent", icon: "🤖", at: 1, working: "Reading your PO…", done: "Read your PO", pending: "Will read your PO" },
  { kind: "core", key: "compliance", name: "Compliance agent", icon: "🛡️", at: 3, working: "Running compliance checks…", done: "Compliance checks passed", pending: "Will run compliance checks" },
  { kind: "later", key: "freight", name: "Freight agent", icon: "🚢", note: "Carrier quotes when you need them" },
  { kind: "later", key: "logistics", name: "Logistics agent", icon: "📦", note: "Booking help when you need it" },
  { kind: "later", key: "certification", name: "Certification agent", icon: "📜", note: "Certificates if your goods need them" },
  { kind: "core", key: "documents", name: "Documents agent", icon: "📄", at: 4, working: "Drafting your documents…", done: "Drafted your documents", pending: "Will draft your documents" },
  { kind: "core", key: "filing", name: "Filing agent", icon: "📧", at: 6, working: "Sending to your CHA…", done: "Sent to your CHA", pending: "Will send to your CHA" },
  { kind: "later", key: "tracking", name: "Tracking agent", icon: "📡", note: "Tracks your shipment after dispatch" },
  { kind: "later", key: "treasury", name: "Treasury agent", icon: "💰", note: "Payment & eBRC — coming later" },
];

export function agentFleet(
  status: string,
  freight: { pending: boolean; awarded: boolean },
  certs: { ready: boolean; count: number },
  logistics: { ready: boolean },
  tracking: { ready: boolean; summary: string }
): AgentCard[] {
  const idx = STAGE[status] ?? 0;

  return FLEET.map((a): AgentCard => {
    if (a.kind === "core") {
      const state: AgentState = idx < a.at ? "pending" : idx === a.at ? "working" : "done";
      // A flagged shipment is being handled by a person, not silently "working".
      if (status === "bucket_b_review" && state === "working") {
        return { key: a.key, name: a.name, icon: a.icon, state: "review", note: "Our team is reviewing this step" };
      }
      const note = state === "working" ? a.working : state === "done" ? a.done : a.pending;
      return { key: a.key, name: a.name, icon: a.icon, state, note };
    }

    // Freight shows REAL state once it has quotes on this shipment.
    if (a.key === "freight") {
      if (freight.awarded) return { key: a.key, name: a.name, icon: a.icon, state: "done", note: "Carrier awarded" };
      if (freight.pending) return { key: a.key, name: a.name, icon: a.icon, state: "working", note: "Quotes ready — needs your decision" };
    }

    // Certification shows REAL state once the agent has listed this shipment's certs.
    if (a.key === "certification" && certs.ready) {
      return {
        key: a.key,
        name: a.name,
        icon: a.icon,
        state: "done",
        note: `Listed ${certs.count} certificate${certs.count === 1 ? "" : "s"} you'll need`,
      };
    }

    // Logistics is live once a booking request has been drafted for this shipment.
    if (a.key === "logistics" && logistics.ready) {
      return { key: a.key, name: a.name, icon: a.icon, state: "done", note: "Booking requested" };
    }

    // Tracking is live once a carrier update has been read for this shipment.
    if (a.key === "tracking" && tracking.ready) {
      return { key: a.key, name: a.name, icon: a.icon, state: "working", note: tracking.summary || "Tracking your shipment" };
    }

    return { key: a.key, name: a.name, icon: a.icon, state: "later", note: a.note };
  });
}

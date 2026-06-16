// Translate raw audit rows into a plain-English activity feed — the story of
// every decision the agent (and the humans) made on a shipment. Shared by the
// operator dashboard and the exporter portal (PII-safe — narration only).

type AuditRow = {
  id: string;
  operator_id: string | null;
  action_type: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
};

export type Activity = {
  id: string;
  actor: "Qra" | "You" | "Customer";
  icon: string;
  text: string;
  tone: string; // tailwind text colour
  created_at: string;
};

const STATUS_ACTIVITY: Record<string, { icon: string; text: string; tone: string }> = {
  data_extracting: { icon: "🤖", text: "Reading the PO and extracting the details", tone: "text-zinc-700" },
  awaiting_order_confirm: { icon: "📋", text: "Read the order — waiting for it to be confirmed", tone: "text-amber-700" },
  awaiting_customer_info: { icon: "💬", text: "Asked the customer for missing details", tone: "text-yellow-700" },
  awaiting_customer_verify: { icon: "📋", text: "Asked the customer to check a couple of details", tone: "text-amber-700" },
  generating_documents: { icon: "📄", text: "Generating the documents", tone: "text-violet-700" },
  bucket_b_review: { icon: "👀", text: "Flagged for your review", tone: "text-indigo-700" },
  sanctions_screening: { icon: "🛑", text: "Held for sanctions review", tone: "text-orange-700" },
  awaiting_customer_approval: { icon: "📲", text: "Sent the documents to the customer for approval", tone: "text-blue-700" },
  customer_approved: { icon: "✅", text: "Customer approved the documents", tone: "text-green-700" },
  filed_with_cha: { icon: "📧", text: "Emailed the documents to the customs broker", tone: "text-teal-700" },
  customs_cleared: { icon: "🛃", text: "Customs cleared", tone: "text-emerald-700" },
  in_transit: { icon: "🚢", text: "In transit", tone: "text-blue-700" },
  delivered: { icon: "📦", text: "Delivered", tone: "text-emerald-700" },
  completed: { icon: "🏁", text: "Shipment completed", tone: "text-zinc-700" },
  rejected: { icon: "❌", text: "Shipment rejected", tone: "text-red-700" },
  order_declined: { icon: "❌", text: "Order declined", tone: "text-zinc-700" },
  po_received: { icon: "📥", text: "PO received", tone: "text-amber-700" },
};

function noteActivity(
  nv: Record<string, unknown>
): { icon: string; text: string; tone: string; actor?: Activity["actor"] } | null {
  const event = typeof nv.event === "string" ? nv.event : "";
  switch (event) {
    case "order_source":
      return { icon: "📥", text: "Order received as a text message", tone: "text-amber-700" };
    case "order_confirmed":
      return { icon: "✅", text: "Order confirmed", tone: "text-green-700", actor: "Customer" };
    case "order_declined":
      return { icon: "❌", text: "Order declined", tone: "text-zinc-700", actor: "Customer" };
    case "sanctions_screened_clear":
      return { icon: "🛡️", text: "Screened the parties against US + UN + EU lists — clear", tone: "text-emerald-700" };
    case "sanctions_potential_match": {
      const strong = nv.match_strength === "strong";
      return {
        icon: "🚨",
        text: strong
          ? "Possible STRONG sanctions match — held for review"
          : "Possible sanctions match — held for review",
        tone: "text-red-700",
      };
    }
    case "sanctions_screening_unavailable":
      return { icon: "⚠️", text: "Couldn't complete sanctions screening — held to be safe", tone: "text-orange-700" };
    case "trust_gate_flagged":
      return { icon: "👀", text: "Some details needed checking — flagged for your review", tone: "text-indigo-700" };
    case "customer_verify_requested":
      return { icon: "📋", text: "Asked the customer to confirm a few details", tone: "text-amber-700" };
    case "freight_rfq_sent":
      return { icon: "🚢", text: "Sent a freight quote-request to a carrier", tone: "text-blue-700" };
    case "value_amount_computed_and_confirmed":
      return { icon: "🧮", text: "Calculated the invoice value and the customer confirmed it", tone: "text-zinc-700" };
    case "customer_notify_failed":
    case "order_confirm_notify_failed":
    case "customer_verify_notify_failed":
      return { icon: "⚠️", text: "Couldn't reach the customer on WhatsApp", tone: "text-orange-700" };
    default:
      // PRIVACY: only narrate KNOWN, exporter-safe events. Operator free-text
      // notes (new_value.notes) must NEVER render — do NOT add a generic
      // fallback here, or internal commentary would leak to the exporter portal.
      if (typeof nv.customer_message === "string") {
        return { icon: "💬", text: "Customer sent a message", tone: "text-zinc-700", actor: "Customer" };
      }
      return null;
  }
}

export function toActivities(rows: AuditRow[]): Activity[] {
  const out: Activity[] = [];
  for (const r of rows) {
    const isSystem = !r.operator_id;
    const base = { id: r.id, created_at: r.created_at };

    if (r.action_type === "status_change") {
      const status = (r.new_value as { status?: string } | null)?.status ?? "";
      const a = STATUS_ACTIVITY[status];
      if (a) out.push({ ...base, actor: "Qra", icon: a.icon, text: a.text, tone: a.tone });
      continue;
    }

    if (r.action_type === "extract") {
      if (isSystem) {
        out.push({ ...base, actor: "Qra", icon: "✏️", text: "Updated the shipment details", tone: "text-zinc-700" });
      } else {
        out.push({ ...base, actor: "You", icon: "✏️", text: "Edited the shipment details", tone: "text-zinc-700" });
      }
      continue;
    }

    if (r.action_type === "approve") {
      const byCustomer = (r.new_value as { approved_by?: string } | null)?.approved_by === "customer";
      const ev = (r.new_value as { event?: string } | null)?.event;
      if (ev === "order_confirmed") {
        out.push({ ...base, actor: "Customer", icon: "✅", text: "Order confirmed", tone: "text-green-700" });
      } else if (ev === "order_verified") {
        out.push({ ...base, actor: "Customer", icon: "✅", text: "Confirmed the order details", tone: "text-green-700" });
      } else {
        out.push({
          ...base,
          actor: byCustomer ? "Customer" : "You",
          icon: "✅",
          text: byCustomer ? "Approved the documents" : "Approved and sent the documents",
          tone: "text-green-700",
        });
      }
      continue;
    }

    if (r.action_type === "reject") {
      out.push({ ...base, actor: isSystem ? "Qra" : "You", icon: "❌", text: "Rejected the shipment", tone: "text-red-700" });
      continue;
    }

    if (r.action_type === "note") {
      const nv = (r.new_value ?? {}) as Record<string, unknown>;
      const a = noteActivity(nv);
      if (a) out.push({ ...base, actor: a.actor ?? "Qra", icon: a.icon, text: a.text, tone: a.tone });
      continue;
    }
  }
  return out;
}

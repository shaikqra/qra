import Link from "next/link";
import { ensureOperator } from "../layout";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

// Shipments that need an operator's attention, in one place, worst first.
const ATTENTION_STATUSES = [
  "sanctions_screening",
  "bucket_b_review",
  "awaiting_customer_info",
];

type ShipmentRow = {
  id: string;
  reference_number: string;
  customer_id: string;
  status: string;
  created_at: string;
  extracted_data: Record<string, string> | null;
};

type CustomerRow = { id: string; display_name: string | null; whatsapp_number: string | null };

type NoteRow = {
  shipment_id: string;
  new_value: { event?: string; match_strength?: string } | null;
  created_at: string;
};

function customerLabel(c: CustomerRow | undefined, id: string): string {
  if (c?.display_name) return c.display_name;
  if (c?.whatsapp_number) return c.whatsapp_number.replace(/^whatsapp:/, "");
  return `${id.slice(0, 8)}…`;
}

// Lower number = more urgent (sorted to the top).
function reasonFor(
  status: string,
  note: NoteRow | undefined
): { priority: number; label: string; tone: string } {
  const event = note?.new_value?.event;
  if (event === "sanctions_potential_match") {
    const strong = note?.new_value?.match_strength === "strong";
    return {
      priority: strong ? 0 : 1,
      label: strong ? "⚠️ Strong sanctions match — review now" : "⚠️ Possible sanctions match",
      tone: "text-red-700",
    };
  }
  if (event === "sanctions_screening_unavailable") {
    return {
      priority: 2,
      label: "Screening unavailable — a list isn't loaded or failed",
      tone: "text-orange-700",
    };
  }
  if (status === "sanctions_screening") {
    return { priority: 2, label: "In sanctions screening", tone: "text-orange-700" };
  }
  if (event === "trust_gate_flagged" || status === "bucket_b_review") {
    return {
      priority: 3,
      label: "Needs a data check (low confidence or failed a rule)",
      tone: "text-indigo-700",
    };
  }
  return { priority: 4, label: "Waiting on the customer for missing details", tone: "text-yellow-700" };
}

export default async function ReviewQueuePage() {
  await ensureOperator();
  const supabase = await createSupabaseAuthClient();

  const { data: shipmentRows } = await supabase
    .from("shipments")
    .select("id, reference_number, customer_id, status, created_at, extracted_data")
    .in("status", ATTENTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(200);
  const shipments = (shipmentRows ?? []) as ShipmentRow[];

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, display_name, whatsapp_number");
  const customersById = new Map(((customerRows ?? []) as CustomerRow[]).map((c) => [c.id, c]));

  // Latest flag note per shipment (notes carry an `event` describing the flag).
  const ids = shipments.map((s) => s.id);
  const latestNote = new Map<string, NoteRow>();
  if (ids.length > 0) {
    const { data: noteRows } = await supabase
      .from("audit_operator_action")
      .select("shipment_id, new_value, created_at")
      .in("shipment_id", ids)
      .eq("action_type", "note")
      .order("created_at", { ascending: false });
    for (const n of (noteRows ?? []) as NoteRow[]) {
      if (n.new_value?.event && !latestNote.has(n.shipment_id)) latestNote.set(n.shipment_id, n);
    }
  }

  const rows = shipments
    .map((s) => ({ s, reason: reasonFor(s.status, latestNote.get(s.id)) }))
    .sort((a, b) => a.reason.priority - b.reason.priority);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <span className="text-sm text-zinc-500">{rows.length} need attention</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          Nothing needs review right now. 🎉
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Buyer</th>
                <th className="px-4 py-3 font-medium">Why it&apos;s here</th>
                <th className="px-4 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(({ s, reason }) => (
                <tr key={s.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/internal/shipments/${s.id}`} className="text-zinc-900 hover:underline">
                      {s.reference_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {customerLabel(customersById.get(s.customer_id), s.customer_id)}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 truncate max-w-xs">
                    {s.extracted_data?.buyer_name || <span className="text-zinc-400">—</span>}
                  </td>
                  <td className={`px-4 py-3 font-medium ${reason.tone}`}>{reason.label}</td>
                  <td className="px-4 py-3 text-zinc-500">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

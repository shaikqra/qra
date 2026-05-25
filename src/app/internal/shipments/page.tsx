import Link from "next/link";
import { ensureOperator } from "../layout";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

type ShipmentRow = {
  id: string;
  reference_number: string;
  customer_id: string;
  status: string;
  created_at: string;
  customer_po_number: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  po_received: "bg-amber-100 text-amber-800",
  data_extracting: "bg-sky-100 text-sky-800",
  awaiting_customer_info: "bg-yellow-100 text-yellow-800",
  generating_documents: "bg-violet-100 text-violet-800",
  sanctions_screening: "bg-orange-100 text-orange-800",
  bucket_b_review: "bg-indigo-100 text-indigo-800",
  awaiting_customer_approval: "bg-yellow-100 text-yellow-800",
  filed_with_cha: "bg-teal-100 text-teal-800",
  customs_cleared: "bg-emerald-100 text-emerald-800",
  in_transit: "bg-blue-100 text-blue-800",
  delivered: "bg-emerald-200 text-emerald-900",
  completed: "bg-zinc-200 text-zinc-800",
  rejected: "bg-red-100 text-red-800",
};

export default async function ShipmentsListPage() {
  await ensureOperator();
  const supabase = await createSupabaseAuthClient();

  const { data: shipments, error } = await supabase
    .from("shipments")
    .select("id, reference_number, customer_id, status, created_at, customer_po_number")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Could not load shipments. Try refreshing.
      </div>
    );
  }

  const rows = (shipments ?? []) as ShipmentRow[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Shipments</h1>
        <span className="text-sm text-zinc-500">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          No shipments yet. They appear here as exporters send POs via WhatsApp.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">PO note</th>
                <th className="px-4 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/internal/shipments/${r.id}`}
                      className="text-zinc-900 hover:underline"
                    >
                      {r.reference_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {r.customer_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[r.status] ?? "bg-zinc-100 text-zinc-700"
                      }`}
                    >
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 truncate max-w-xs">
                    {r.customer_po_number ?? <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {new Date(r.created_at).toLocaleString()}
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

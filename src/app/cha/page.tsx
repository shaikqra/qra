import Link from "next/link";
import { ensureCha } from "@/lib/supabase/cha-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  reference_number: string;
  status: string;
  cha_review_status: string | null;
  cha_reviewed_at: string | null;
  extracted_data: Record<string, unknown> | null;
  customers: { display_name: string | null } | { display_name: string | null }[] | null;
};

// Shipments that have reached the broker (approved by the exporter's customer and beyond).
const HANDED_OVER = [
  "customer_approved",
  "filed_with_cha",
  "customs_cleared",
  "in_transit",
  "delivered",
  "completed",
];

function exporterName(r: Row): string {
  const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
  return c?.display_name?.trim() || "Exporter";
}

function field(r: Row, key: string): string {
  const v = r.extracted_data?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function goodsLine(r: Row): string {
  const product = field(r, "product_description") || "Goods";
  const qty = field(r, "quantity");
  const unit = field(r, "quantity_unit");
  const dest = field(r, "port_of_discharge");
  const bits = [product];
  if (qty) bits.push(`${qty} ${unit}`.trim());
  if (dest) bits.push(`→ ${dest}`);
  return bits.join(" · ");
}

function Card({ r }: { r: Row }) {
  const status = r.cha_review_status;
  return (
    <Link
      href={`/cha/${r.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-[#3f5bd9] hover:bg-[#eef1fc] transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-slate-900">{r.reference_number}</span>
        <span className="text-sm font-semibold text-slate-800">· {exporterName(r)}</span>
        <span className="ml-auto text-xs font-semibold">
          {status === "filed" ? (
            <span className="text-emerald-600">✓ Filed</span>
          ) : status === "docs_approved" ? (
            <span className="text-[#3f5bd9]">Approved · file →</span>
          ) : status === "changes_requested" ? (
            <span className="text-amber-600">Changes requested</span>
          ) : (
            <span className="text-[#3f5bd9]">Review →</span>
          )}
        </span>
      </div>
      <div className="text-sm text-slate-500 mt-1">{goodsLine(r)}</div>
    </Link>
  );
}

export default async function ChaHome() {
  await ensureCha();
  const supabase = await createSupabaseAuthClient();

  const { data } = await supabase
    .from("shipments")
    .select(
      "id, reference_number, status, cha_review_status, cha_reviewed_at, extracted_data, customers(display_name)"
    )
    .in("status", HANDED_OVER)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  // Until the broker has actually filed (G6), the shipment still needs them —
  // including ones where they've approved the docs or asked for a change.
  const todo = rows.filter((r) => r.cha_review_status !== "filed");
  const done = rows.filter((r) => r.cha_review_status === "filed");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your filing desk</h1>
        <p className="text-sm text-slate-500 mt-1">
          Exporter-approved document packs, ready for you to review and file. You file on ICEGATE
          with your own DSC — Qra never holds your signature.
        </p>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Needs your action {todo.length > 0 && <span className="text-[#3f5bd9]">· {todo.length}</span>}
        </h2>
        {todo.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Nothing waiting on you right now.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {todo.map((r) => (
              <Card key={r.id} r={r} />
            ))}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Filed
          </h2>
          <div className="flex flex-col gap-2">
            {done.map((r) => (
              <Card key={r.id} r={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureCha } from "@/lib/supabase/cha-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ChaReviewChat } from "./cha-review-chat";

export const dynamic = "force-dynamic";

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
  shipping_bill_pack: "Shipping Bill Data Sheet",
  export_declaration: "Export Declaration",
};

type Shipment = {
  id: string;
  reference_number: string;
  status: string;
  cha_review_status: string | null;
  cha_review_note: string | null;
  cha_reviewed_at: string | null;
  extracted_data: Record<string, unknown> | null;
  customers: { display_name: string | null } | { display_name: string | null }[] | null;
};

function f(data: Record<string, unknown> | null, k: string): string {
  const v = data?.[k];
  return typeof v === "string" ? v.trim() : "";
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</div>
      <div className="text-slate-800">{v || "—"}</div>
    </div>
  );
}

export default async function ChaShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureCha();
  const { id } = await params;
  const supabase = await createSupabaseAuthClient();

  // RLS returns nothing if this isn't one of this broker's shipments.
  const { data } = await supabase
    .from("shipments")
    .select(
      "id, reference_number, status, cha_review_status, cha_review_note, cha_reviewed_at, extracted_data, customers(display_name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const ship = data as unknown as Shipment;
  const ed = ship.extracted_data;
  const cust = Array.isArray(ship.customers) ? ship.customers[0] : ship.customers;

  const { data: docRows } = await supabase
    .from("generated_documents")
    .select("doc_type, storage_path, generated_at")
    .eq("shipment_id", id)
    .order("generated_at", { ascending: false });

  const latest = new Map<string, string>();
  for (const d of (docRows ?? []) as { doc_type: string; storage_path: string }[]) {
    if (!latest.has(d.doc_type)) latest.set(d.doc_type, d.storage_path);
  }

  // Ownership is already proven by the RLS-scoped read above, so mint short-lived
  // signed download URLs with the service role (storage isn't broker-readable directly).
  const admin = createSupabaseServerClient();
  const files: { label: string; url: string }[] = [];
  for (const [type, path] of latest) {
    const { data: signed } = await admin.storage.from("generated-docs").createSignedUrl(path, 600);
    if (signed?.signedUrl) files.push({ label: DOC_LABELS[type] ?? type, url: signed.signedUrl });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/cha" className="text-sm text-slate-500 hover:text-slate-900">
          ← Your filing desk
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1 font-mono">{ship.reference_number}</h1>
        <p className="text-sm text-slate-500">{cust?.display_name?.trim() || "Exporter"}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Detail k="Goods" v={f(ed, "product_description")} />
        <Detail k="Quantity" v={`${f(ed, "quantity")} ${f(ed, "quantity_unit")}`.trim()} />
        <Detail k="Buyer" v={f(ed, "buyer_name")} />
        <Detail k="Consignee" v={f(ed, "consignee_name")} />
        <Detail k="Port of loading" v={f(ed, "port_of_loading")} />
        <Detail k="Port of discharge" v={f(ed, "port_of_discharge")} />
      </div>

      <ChaReviewChat
        shipmentId={ship.id}
        reference={ship.reference_number}
        status={ship.status}
        files={files}
        reviewStatus={ship.cha_review_status}
        reviewNote={ship.cha_review_note}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureCha } from "@/lib/supabase/cha-auth";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ChaActions } from "./cha-actions";

export const dynamic = "force-dynamic";

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
  shipping_bill_pack: "Shipping Bill Data Sheet",
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
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{k}</div>
      <div className="text-zinc-800">{v || "—"}</div>
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

  const filed = ship.cha_review_status === "filed";
  const changes = ship.cha_review_status === "changes_requested";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/cha" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Your filing desk
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1 font-mono">{ship.reference_number}</h1>
        <p className="text-sm text-zinc-500">{cust?.display_name?.trim() || "Exporter"}</p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Detail k="Goods" v={f(ed, "product_description")} />
        <Detail k="Quantity" v={`${f(ed, "quantity")} ${f(ed, "quantity_unit")}`.trim()} />
        <Detail k="Buyer" v={f(ed, "buyer_name")} />
        <Detail k="Consignee" v={f(ed, "consignee_name")} />
        <Detail k="Port of loading" v={f(ed, "port_of_loading")} />
        <Detail k="Port of discharge" v={f(ed, "port_of_discharge")} />
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Document pack
        </h2>
        {files.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
            No documents on this shipment yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {files.map((file) => (
              <a
                key={file.label}
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 hover:border-emerald-300 hover:bg-emerald-50"
              >
                <span className="text-lg">📄</span>
                <span className="text-sm font-semibold text-emerald-800">{file.label}</span>
                <span className="ml-auto text-xs font-semibold text-zinc-500">Open ↗</span>
              </a>
            ))}
          </div>
        )}
      </section>

      {filed ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          ✓ You marked this <b>filed with customs</b>
          {ship.cha_reviewed_at ? ` on ${new Date(ship.cha_reviewed_at).toLocaleDateString()}` : ""}.
          {ship.cha_review_note && <div className="text-emerald-700 mt-1">Note: {ship.cha_review_note}</div>}
        </div>
      ) : (
        <>
          {changes && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              You requested changes
              {ship.cha_review_note ? `: ${ship.cha_review_note}` : ""}. Recorded for the exporter to
              revise — you can still file once it&apos;s fixed.
            </div>
          )}
          <ChaActions shipmentId={ship.id} />
        </>
      )}
    </div>
  );
}

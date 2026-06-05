import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureOperator } from "../../layout";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ExtractionForm } from "./extraction-form";
import { InvoicePanel } from "./invoice-panel";

type Shipment = {
  id: string;
  reference_number: string;
  customer_id: string;
  status: string;
  extracted_data: Record<string, string>;
  notes: string | null;
  customer_po_number: string | null;
  created_at: string;
};

type IngestRow = {
  id: string;
  storage_path: string;
  file_sha256: string;
  source: string;
  created_at: string;
};

type AuditRow = {
  id: string;
  action_type: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
};

type GeneratedDocRow = {
  id: string;
  doc_type: string;
  storage_path: string;
  output_sha256: string;
  generated_at: string;
};

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureOperator();
  const { id } = await params;

  const supabase = await createSupabaseAuthClient();

  const { data: shipment } = await supabase
    .from("shipments")
    .select(
      "id, reference_number, customer_id, status, extracted_data, notes, customer_po_number, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!shipment) notFound();
  const ship = shipment as Shipment;

  const { data: ingestRows } = await supabase
    .from("audit_po_ingest")
    .select("id, storage_path, file_sha256, source, created_at")
    .eq("shipment_id", id)
    .order("created_at", { ascending: true });

  const files = (ingestRows ?? []) as IngestRow[];

  // Service-role client to mint signed URLs (anon RLS could be tightened later).
  const admin = createSupabaseServerClient();
  const signedFiles = await Promise.all(
    files.map(async (f) => {
      const { data } = await admin.storage
        .from("purchase-orders")
        .createSignedUrl(f.storage_path, 60 * 10);
      return { ...f, url: data?.signedUrl ?? null };
    })
  );

  const { data: auditRows } = await supabase
    .from("audit_operator_action")
    .select("id, action_type, old_value, new_value, created_at")
    .eq("shipment_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const auditTrail = (auditRows ?? []) as AuditRow[];

  const { data: genRows } = await supabase
    .from("generated_documents")
    .select("id, doc_type, storage_path, output_sha256, generated_at")
    .eq("shipment_id", id)
    .order("generated_at", { ascending: false });

  const generatedDocs = await Promise.all(
    ((genRows ?? []) as GeneratedDocRow[]).map(async (g) => {
      const { data } = await admin.storage
        .from("generated-docs")
        .createSignedUrl(g.storage_path, 60 * 10);
      return {
        id: g.id,
        doc_type: g.doc_type,
        output_sha256: g.output_sha256,
        generated_at: g.generated_at,
        url: data?.signedUrl ?? null,
      };
    })
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/internal/shipments"
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            ← All shipments
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            {ship.reference_number}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Customer{" "}
            <span className="font-mono">{ship.customer_id.slice(0, 8)}…</span> · received{" "}
            {new Date(ship.created_at).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            PO files ({signedFiles.length})
          </h2>
          {signedFiles.length === 0 ? (
            <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
              No files attached.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {signedFiles.map((f) => {
                const isImage = /\.(jpe?g|png)$/i.test(f.storage_path);
                const isPdf = /\.pdf$/i.test(f.storage_path);
                return (
                  <div
                    key={f.id}
                    className="rounded-md border border-zinc-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
                      <span className="font-mono truncate">{f.storage_path.split("/").pop()}</span>
                      {f.url && (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-700 hover:underline"
                        >
                          Open ↗
                        </a>
                      )}
                    </div>
                    {f.url && isImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.url}
                        alt="PO preview"
                        className="w-full max-h-96 object-contain rounded"
                      />
                    )}
                    {f.url && isPdf && (
                      <iframe
                        src={f.url}
                        className="w-full h-96 rounded border border-zinc-200"
                        title="PO PDF"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {ship.customer_po_number && (
            <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
                Customer text
              </div>
              <div className="text-zinc-800 whitespace-pre-wrap">
                {ship.customer_po_number}
              </div>
            </div>
          )}
        </section>

        <section>
          <ExtractionForm
            shipmentId={ship.id}
            initialExtracted={ship.extracted_data ?? {}}
            initialStatus={ship.status}
            initialNotes={ship.notes ?? ""}
          />
        </section>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Documents
        </h2>
        <InvoicePanel shipmentId={ship.id} docs={generatedDocs} />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Audit trail ({auditTrail.length})
        </h2>
        {auditTrail.length === 0 ? (
          <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
            No operator actions yet.
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {auditTrail.map((a) => (
              <li
                key={a.id}
                className="rounded-md border border-zinc-200 bg-white p-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-700">{a.action_type}</span>
                  <span className="text-zinc-500">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
                <pre className="mt-2 text-[11px] text-zinc-600 whitespace-pre-wrap break-words">
                  {JSON.stringify({ old: a.old_value, new: a.new_value }, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

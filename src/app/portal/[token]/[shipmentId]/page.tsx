import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCustomerByPortalToken, portalRateLimited } from "@/lib/portal/auth";
import { portalActionHint, portalStageIndex } from "@/lib/portal/stages";
import { isExporterVisibleDoc } from "@/lib/docs/doc-visibility";
import { toActivities } from "@/lib/shipment-activity";
import { Timeline } from "../timeline";
import { GateActions } from "./gate-actions";

export const dynamic = "force-dynamic";

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
};

type Shipment = {
  id: string;
  reference_number: string;
  status: string;
  extracted_data: Record<string, unknown> | null;
};

function f(d: Record<string, unknown> | null, k: string): string {
  const v = d?.[k];
  return typeof v === "string" ? v.trim() : "";
}

// The exporter is the "Customer"; operator/system actions read as "Qra" to them.
function exporterActor(a: "Qra" | "You" | "Customer"): string {
  return a === "Customer" ? "You" : "Qra";
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{k}</div>
      <div className="text-zinc-800">{v || "—"}</div>
    </div>
  );
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

export default async function PortalShipment({
  params,
}: {
  params: Promise<{ token: string; shipmentId: string }>;
}) {
  if (portalRateLimited(await clientIp())) {
    return <p className="text-sm text-zinc-500">Too many requests — please wait a moment and refresh.</p>;
  }

  const { token, shipmentId } = await params;
  const customer = await resolveCustomerByPortalToken(token);
  if (!customer) notFound();

  const admin = createSupabaseServerClient();
  // Scope to THIS customer — a shipment id from another exporter must 404.
  const { data } = await admin
    .from("shipments")
    .select("id, reference_number, status, extracted_data")
    .eq("id", shipmentId)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (!data) notFound();
  const ship = data as Shipment;
  const ed = ship.extracted_data;

  // Documents appear only once they've been sent to the exporter for approval
  // (the "Your approval" stage onward) — never an in-progress draft we're still
  // reviewing, and never the broker-only Shipping Bill sheet (NOT_FOR_CUSTOMER).
  const files: { label: string; url: string }[] = [];
  if (portalStageIndex(ship.status) >= 2) {
    const { data: docRows } = await admin
      .from("generated_documents")
      .select("doc_type, storage_path, generated_at")
      .eq("shipment_id", shipmentId)
      .order("generated_at", { ascending: false });

    const latest = new Map<string, string>();
    for (const d of (docRows ?? []) as { doc_type: string; storage_path: string }[]) {
      if (isExporterVisibleDoc(d.doc_type) && !latest.has(d.doc_type)) {
        latest.set(d.doc_type, d.storage_path);
      }
    }
    for (const [type, path] of latest) {
      const { data: signed } = await admin.storage.from("generated-docs").createSignedUrl(path, 600);
      if (signed?.signedUrl) files.push({ label: DOC_LABELS[type] ?? type, url: signed.signedUrl });
    }
  }

  // Plain-English story of what Qra did — reuses the operator activity feed.
  const { data: auditRows } = await admin
    .from("audit_operator_action")
    .select("id, operator_id, action_type, old_value, new_value, created_at")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true });
  const activities = toActivities((auditRows ?? []) as Parameters<typeof toActivities>[0]);

  const hint = portalActionHint(ship.status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/portal/${token}`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← All shipments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1 font-mono text-zinc-900">
          {ship.reference_number}
        </h1>
      </div>

      <GateActions token={token} shipmentId={shipmentId} status={ship.status} />

      {ship.status === "awaiting_customer_info" && hint && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {hint}
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Progress</h2>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <Timeline status={ship.status} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Order</h2>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Detail k="Goods" v={f(ed, "product_description")} />
          <Detail k="Quantity" v={`${f(ed, "quantity")} ${f(ed, "quantity_unit")}`.trim()} />
          <Detail k="Buyer" v={f(ed, "buyer_name")} />
          <Detail k="Value" v={`${f(ed, "value_currency")} ${f(ed, "value_amount")}`.trim()} />
          <Detail k="Incoterm" v={f(ed, "incoterm")} />
          <Detail k="Port of discharge" v={f(ed, "port_of_discharge")} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Documents</h2>
        {files.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
            No documents ready yet — they&apos;ll appear here once Qra has prepared them.
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

      {activities.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Activity</h2>
          <div className="rounded-xl border border-zinc-200 bg-white p-5 flex flex-col gap-3">
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <span className="text-base leading-none mt-0.5">{a.icon}</span>
                <div>
                  <div className={`text-sm ${a.tone}`}>{a.text}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {exporterActor(a.actor)} · {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

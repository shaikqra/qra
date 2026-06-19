import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCustomerByPortalToken, portalRateLimited } from "@/lib/portal/auth";
import { portalActionHint, portalStageIndex } from "@/lib/portal/stages";
import { validateExtracted, lowConfidenceFields } from "@/lib/docs/validate";
import { verifyFieldLines, readStoredConfidence, readDraftedFields, fieldLabel, verifyKeys } from "@/lib/docs/verify-gate";
import { isExporterVisibleDoc } from "@/lib/docs/doc-visibility";
import { toActivities } from "@/lib/shipment-activity";
import { loadRankedFreight } from "@/lib/freight/load";
import { Timeline } from "../timeline";
import { GateActions } from "./gate-actions";
import { FreightGate } from "./freight-gate";
import { OptionalDocs } from "./optional-docs";
import { agentFleet } from "@/lib/portal/agent-fleet";
import { AgentFleet } from "./agent-fleet";
import { LiveRefresh } from "./live-refresh";
import { CertList, type CertItem } from "./cert-list";
import { documentProvenance } from "@/lib/provenance/fields";
import { ProvenancePanel } from "./provenance-panel";
import { TrackingCard, type Tracking } from "./tracking-card";
import { PortalChat } from "./portal-chat";

export const dynamic = "force-dynamic";

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
  export_declaration: "Export Declaration / Annexure",
  shipping_bill_pack: "Shipping Bill Checklist",
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

const BRAND = "#3f5bd9";

const STATUS_STYLE: Record<string, { label: string; cls: string; live?: boolean }> = {
  po_received: { label: "Received", cls: "bg-amber-100 text-amber-800" },
  data_extracting: { label: "Reading PO", cls: "bg-sky-100 text-sky-800", live: true },
  awaiting_order_confirm: { label: "Confirm order", cls: "bg-violet-100 text-violet-800" },
  awaiting_customer_info: { label: "Needs details", cls: "bg-amber-100 text-amber-800" },
  awaiting_customer_verify: { label: "Check details", cls: "bg-amber-100 text-amber-800" },
  generating_documents: { label: "Drafting docs", cls: "bg-violet-100 text-violet-800", live: true },
  sanctions_screening: { label: "Screening", cls: "bg-orange-100 text-orange-800", live: true },
  bucket_b_review: { label: "In review", cls: "bg-indigo-100 text-indigo-800" },
  awaiting_customer_approval: { label: "Your approval", cls: "bg-blue-100 text-blue-800" },
  awaiting_goods_ready: { label: "Goods ready?", cls: "bg-amber-100 text-amber-800" },
  customer_approved: { label: "Sending to CHA", cls: "bg-emerald-100 text-emerald-800", live: true },
  filed_with_cha: { label: "With your CHA", cls: "bg-teal-100 text-teal-800" },
  customs_cleared: { label: "Customs cleared", cls: "bg-emerald-100 text-emerald-800" },
  in_transit: { label: "In transit", cls: "bg-blue-100 text-blue-800" },
  delivered: { label: "Delivered", cls: "bg-emerald-100 text-emerald-800" },
  completed: { label: "Completed", cls: "bg-slate-200 text-slate-700" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-800" },
  order_declined: { label: "Declined", cls: "bg-slate-200 text-slate-700" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status.replace(/_/g, " "), cls: "bg-slate-100 text-slate-700" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.cls}`}>
      {s.live && <span className="h-1.5 w-1.5 rounded-full bg-current animate-soft-pulse" />}
      {s.label}
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: BRAND }}>
      {children}
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</div>
      <div className="text-slate-800">{v || "—"}</div>
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
  // reviewing. isExporterVisibleDoc filters out any broker-only doc types.
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

  // Freight quotes for the G4 gate (shipment already verified as this customer's).
  const rankedFreight = await loadRankedFreight(admin, shipmentId);

  // Provenance: where every value on the documents came from (profile / PO / draft).
  const { data: profileRow } = await admin
    .from("exporter_profiles")
    .select("*")
    .eq("customer_id", customer.id)
    .maybeSingle();
  const provenance = documentProvenance(
    (ed ?? {}) as Record<string, string>,
    (profileRow ?? {}) as Record<string, string>
  );

  // Certification agent output (advisory list, stored under the reserved key).
  let certItems: CertItem[] = [];
  try {
    const parsed = JSON.parse(((ed?.["_certifications"] as string) ?? "[]"));
    if (Array.isArray(parsed)) {
      // Source is agent / Trade-Graph output — validate each entry rather than
      // trusting the cast: keep only objects, coerce fields to strings, and drop
      // anything without a name so a malformed item can't render garbage.
      certItems = parsed
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          name: typeof c.name === "string" ? c.name : "",
          note: typeof c.note === "string" ? c.note : "",
          issuedBy: typeof c.issuedBy === "string" ? c.issuedBy : "",
        }))
        .filter((c) => c.name);
    }
  } catch {
    certItems = [];
  }

  // Logistics + Tracking agent output (stored under reserved keys).
  const bookingReady = !!f(ed, "_booking_draft");
  let tracking: Tracking | null = null;
  try {
    const t = JSON.parse((f(ed, "_tracking") || "null"));
    if (t && typeof t === "object") tracking = t as Tracking;
  } catch {
    tracking = null;
  }

  // Agent cards: what the fleet is doing on this shipment, from real state.
  const fleet = agentFleet(
    ship.status,
    { pending: !rankedFreight.awarded && rankedFreight.ranked.length > 0, awarded: !!rankedFreight.awarded },
    { ready: certItems.length > 0, count: certItems.length },
    { ready: bookingReady },
    { ready: !!tracking, summary: tracking?.summary ?? "" }
  );

  // Poll for live agent-card updates only while an agent is actively working (the
  // status will change on its own). At a waiting gate or a terminal state the next
  // move needs a human, so we don't poll.
  const liveActive = [
    "data_extracting",
    "sanctions_screening",
    "generating_documents",
    "customer_approved",
  ].includes(ship.status);

  // If a status gate is already popping up, the freight gate stays a banner (not a
  // second auto-opening modal). These are exactly the statuses GateActions opens on.
  const statusGateActive = [
    "awaiting_order_confirm",
    "awaiting_customer_verify",
    "awaiting_customer_approval",
    "awaiting_goods_ready",
    "awaiting_customer_info",
    "filed_with_cha",
    "customs_cleared",
    "in_transit",
    "delivered",
  ].includes(ship.status);

  // Verify gate (G1): the exact fields Qra wasn't sure about, surfaced for the
  // exporter to confirm or correct. Same computation as the WhatsApp message.
  let verifyLines: string[] = [];
  let verifyFields: { key: string; label: string; value: string; drafted: boolean }[] = [];
  if (ship.status === "awaiting_customer_verify") {
    const ed2 = (ed ?? {}) as Record<string, string>;
    const issues = validateExtracted(ed2);
    const shaky = lowConfidenceFields(ed2, readStoredConfidence(ed2));
    verifyLines = verifyFieldLines(ed2, issues, shaky);
    const drafted = new Set(readDraftedFields(ed2));
    verifyFields = verifyKeys(ed2, issues, shaky).map((k) => ({
      key: k,
      label: fieldLabel(k),
      value: (ed2[k] ?? "").trim(),
      drafted: drafted.has(k),
    }));
  }

  return (
    <div className="flex flex-col gap-6">
      <GateActions
        token={token}
        shipmentId={shipmentId}
        status={ship.status}
        verifyLines={verifyLines}
        verifyFields={verifyFields}
        infoHint={ship.status === "awaiting_customer_info" ? hint : null}
      />

      {/* Top bar */}
      <div className="animate-fade-in-up flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/portal/${token}`} className="text-sm text-slate-500 hover:text-slate-900">
            ← All shipments
          </Link>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-slate-900">
            {ship.reference_number}
          </h1>
        </div>
        <StatusPill status={ship.status} />
      </div>

      {/* Progress */}
      <section
        className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        style={{ animationDelay: "60ms" }}
      >
        <Timeline status={ship.status} />
      </section>

      <LiveRefresh active={liveActive} />

      {/* Cockpit: main column + sidebar */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            <PortalChat token={token} shipmentId={shipmentId} />
          </div>

          <section className="animate-fade-in-up" style={{ animationDelay: "180ms" }}>
            <Eyebrow>Documents</Eyebrow>
            {files.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
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
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 transition hover:-translate-y-0.5 hover:border-[#c7d2fe] hover:shadow-md"
                  >
                    <span className="text-lg">📄</span>
                    <span className="text-sm font-semibold text-slate-800">{file.label}</span>
                    <span className="ml-auto text-xs font-semibold" style={{ color: BRAND }}>
                      Open ↗
                    </span>
                  </a>
                ))}
              </div>
            )}
            {portalStageIndex(ship.status) >= 2 && (
              <div className="mt-3">
                <OptionalDocs token={token} shipmentId={shipmentId} />
              </div>
            )}
          </section>

          <FreightGate
            token={token}
            shipmentId={shipmentId}
            quotes={rankedFreight.ranked}
            awarded={rankedFreight.awarded}
            recommendationId={rankedFreight.recommendationId}
            reason={rankedFreight.reason}
            autoOpen={!statusGateActive}
          />
        </div>

        <aside className="flex flex-col gap-6">
          <section
            className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            style={{ animationDelay: "150ms" }}
          >
            <Eyebrow>Order</Eyebrow>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Detail k="Goods" v={f(ed, "product_description")} />
              <Detail k="Quantity" v={`${f(ed, "quantity")} ${f(ed, "quantity_unit")}`.trim()} />
              <Detail k="Buyer" v={f(ed, "buyer_name")} />
              <Detail k="Value" v={`${f(ed, "value_currency")} ${f(ed, "value_amount")}`.trim()} />
              <Detail k="Incoterm" v={f(ed, "incoterm")} />
              <Detail k="Destination" v={f(ed, "port_of_discharge")} />
            </div>
          </section>

          <div className="animate-fade-in-up" style={{ animationDelay: "210ms" }}>
            <AgentFleet cards={fleet} />
          </div>

          <CertList items={certItems} source={f(ed, "_certifications_source")} citation={f(ed, "_certifications_citation")} />

          <TrackingCard tracking={tracking} />

          <ProvenancePanel rows={provenance} />

          {activities.length > 0 && (
            <section>
              <Eyebrow>Activity</Eyebrow>
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5">
                {activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <span className="mt-0.5 text-base leading-none">{a.icon}</span>
                    <div>
                      <div className={`text-sm ${a.tone}`}>{a.text}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {exporterActor(a.actor)} · {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

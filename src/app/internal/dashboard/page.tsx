import Link from "next/link";
import { ensureOperator } from "../layout";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

// Mission control: how Qra is doing, from real data we already store. Read-only.
// Modelled on the investor cockpit, but every number here is live and every
// agent's status is the truth — nothing simulated.
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// The 9 ExportOS agents and their HONEST status. live = shipping in the product
// today; partial = a first version runs; planned = not built yet.
const AGENTS: { n: string; role: string; tier: "A" | "B" | "C"; status: "live" | "partial" | "planned" }[] = [
  { n: "Indu", role: "Intake", tier: "B", status: "live" },
  // Sanctions screening (US/UN/EU) is live + blocking; HS classify is advisory;
  // destination-rule checking is not built — so "partial", not "planned".
  { n: "Cyrus", role: "Compliance", tier: "B", status: "partial" },
  { n: "Faiz", role: "Freight", tier: "A", status: "planned" },
  { n: "Lyle", role: "Logistics", tier: "B", status: "planned" },
  { n: "Citra", role: "Certification", tier: "B", status: "planned" },
  { n: "Dora", role: "Documents", tier: "B", status: "live" },
  { n: "Felix", role: "Filing copilot", tier: "B", status: "partial" },
  { n: "Watson", role: "Tracking", tier: "B", status: "planned" },
  { n: "Tara", role: "Treasury", tier: "A", status: "planned" },
];

const TIER_BG: Record<string, string> = { A: "bg-[#7A4FBF]", B: "bg-[#2D6CDF]", C: "bg-[#5F6B7A]" };

const STATUS_PILL: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-700 border-emerald-200",
  partial: "bg-amber-100 text-amber-800 border-amber-200",
  planned: "bg-zinc-100 text-zinc-500 border-zinc-200",
};
const STATUS_LABEL: Record<string, string> = { live: "Live", partial: "Partial", planned: "Planned" };

// Pipeline stages in order, with display label + bar colour.
const FUNNEL: { status: string; label: string; bar: string }[] = [
  { status: "po_received", label: "PO received", bar: "bg-amber-400" },
  { status: "data_extracting", label: "Reading PO", bar: "bg-sky-400" },
  { status: "awaiting_order_confirm", label: "Confirm order", bar: "bg-purple-400" },
  { status: "awaiting_customer_info", label: "Awaiting info", bar: "bg-yellow-400" },
  { status: "awaiting_customer_verify", label: "Verify details", bar: "bg-amber-500" },
  { status: "sanctions_screening", label: "Sanctions review", bar: "bg-orange-400" },
  { status: "generating_documents", label: "Generating docs", bar: "bg-violet-400" },
  { status: "bucket_b_review", label: "Your review", bar: "bg-indigo-400" },
  { status: "awaiting_customer_approval", label: "Awaiting approval", bar: "bg-yellow-500" },
  { status: "awaiting_goods_ready", label: "Goods ready?", bar: "bg-amber-500" },
  { status: "customer_approved", label: "Customer approved", bar: "bg-green-400" },
  { status: "filed_with_cha", label: "Filed with CHA", bar: "bg-teal-400" },
  { status: "customs_cleared", label: "Customs cleared", bar: "bg-emerald-400" },
  { status: "in_transit", label: "In transit", bar: "bg-blue-400" },
  { status: "delivered", label: "Delivered", bar: "bg-emerald-500" },
  { status: "completed", label: "Completed", bar: "bg-zinc-400" },
  { status: "rejected", label: "Rejected", bar: "bg-red-400" },
];

const ATTENTION = new Set(["sanctions_screening", "bucket_b_review", "awaiting_customer_info"]);

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function Kpi({ label, value, sub, slo }: { label: string; value: string; sub?: string; slo?: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-[#E0BE55] font-mono tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/55 mt-0.5">{sub}</div>}
      {slo && <div className="text-[10px] text-emerald-300/70 font-mono mt-0.5">{slo}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  await ensureOperator();
  const supabase = await createSupabaseAuthClient();

  // At current scale, fetch and aggregate in code. (Move to SQL aggregates if
  // shipment volume grows past a few thousand.)
  const { data: shipmentRows } = await supabase
    .from("shipments")
    .select("id, status, created_at")
    .limit(5000);
  const shipments = (shipmentRows ?? []) as { id: string; status: string; created_at: string }[];

  const { data: docRows } = await supabase
    .from("generated_documents")
    .select("shipment_id, generated_at")
    .limit(20000);
  const docs = (docRows ?? []) as { shipment_id: string; generated_at: string }[];

  const { count: customerCount } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true });

  // This is a per-request server component, so reading the clock here is
  // intentional and stable within the render (the purity rule assumes a client
  // component that can re-render).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const weekAgo = now - WEEK_MS;

  const totalShipments = shipments.length;
  const shipmentsThisWeek = shipments.filter((s) => new Date(s.created_at).getTime() >= weekAgo).length;
  const docsThisWeek = docs.filter((d) => new Date(d.generated_at).getTime() >= weekAgo).length;
  const needsAttention = shipments.filter((s) => ATTENTION.has(s.status)).length;

  const byStatus = new Map<string, number>();
  for (const s of shipments) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  const maxCount = Math.max(1, ...FUNNEL.map((f) => byStatus.get(f.status) ?? 0));

  // Typical turnaround: PO received → first document, for continuous runs only
  // (under 2 hours), so idle/overnight shipments don't skew the number.
  const createdById = new Map(shipments.map((s) => [s.id, new Date(s.created_at).getTime()]));
  const firstDoc = new Map<string, number>();
  for (const d of docs) {
    const t = new Date(d.generated_at).getTime();
    const cur = firstDoc.get(d.shipment_id);
    if (cur === undefined || t < cur) firstDoc.set(d.shipment_id, t);
  }
  const continuousRuns: number[] = [];
  for (const [id, docTime] of firstDoc) {
    const created = createdById.get(id);
    if (created === undefined) continue;
    const delta = docTime - created;
    if (delta > 0 && delta < 2 * 60 * 60 * 1000) continuousRuns.push(delta);
  }
  const medianTurnaround = median(continuousRuns);

  const liveCount = AGENTS.filter((a) => a.status === "live" || a.status === "partial").length;

  return (
    <div className="flex flex-col gap-6">
      {/* ===== Cockpit hero: brand + doctrine + live KPIs ===== */}
      <div className="rounded-2xl bg-gradient-to-br from-[#101f3d] to-[#1F3864] text-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xl font-extrabold tracking-tight">
              Q<span className="text-[#E0BE55]">ra</span> · Mission Control
            </div>
            <div className="text-[11px] text-white/55 mt-1">
              LLM proposes · rules dispose · humans approve · workflow remembers.
            </div>
            <div className="text-[11px] text-white/40 mt-0.5">
              One country-neutral pipeline · every number below is live.
            </div>
          </div>
          <span className="rounded-full bg-white/5 border border-white/10 px-3 py-1 text-xs font-semibold text-emerald-300">
            {liveCount} of 9 agents live
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <Kpi label="Shipments" value={String(totalShipments)} sub={`+${shipmentsThisWeek} this week`} />
          <Kpi label="Documents made" value={String(docs.length)} sub={`+${docsThisWeek} this week`} />
          <Kpi
            label="Typical turnaround"
            value={medianTurnaround !== null ? fmtDuration(medianTurnaround) : "—"}
            sub="PO → documents"
            slo={medianTurnaround !== null ? "vs hours of manual work" : undefined}
          />
          <Kpi label="Exporters" value={String(customerCount ?? 0)} sub="on WhatsApp" />
        </div>
      </div>

      {/* ===== Needs attention callout ===== */}
      {needsAttention > 0 && (
        <Link
          href="/internal/review"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 hover:bg-amber-100"
        >
          <span className="text-amber-600 text-lg">●</span>
          <span className="text-sm text-amber-900 font-medium">
            {needsAttention} shipment{needsAttention === 1 ? "" : "s"} need your review
          </span>
          <span className="ml-auto text-sm text-amber-700">Open the queue →</span>
        </Link>
      )}

      {/* ===== Agent fleet (honest live/planned) ===== */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Agent fleet</h2>
          <span className="text-xs text-zinc-400">A frontier · B fast · C rules</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AGENTS.map((a) => (
            <div
              key={a.role}
              className={`rounded-xl border bg-white p-3.5 flex items-center gap-3 ${
                a.status === "planned" ? "border-zinc-200 opacity-70" : "border-zinc-200"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg ${TIER_BG[a.tier]} text-white flex items-center justify-center font-bold text-sm flex-shrink-0`}
              >
                {a.n[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-[#1F3864] flex items-center gap-2">
                  {a.n}
                  <span className={`text-[9px] font-bold text-white rounded px-1 ${TIER_BG[a.tier]}`}>{a.tier}</span>
                </div>
                <div className="text-xs text-zinc-500">{a.role}</div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide rounded-full border px-2 py-0.5 ${STATUS_PILL[a.status]}`}
              >
                {STATUS_LABEL[a.status]}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-400 mt-2">
          Agents marked <span className="font-medium text-zinc-500">Planned</span> aren&apos;t built yet — they unlock
          with design partners, integrations and funding. Nothing here is simulated.
        </p>
      </section>

      {/* ===== Pipeline (real shipment counts) ===== */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Pipeline</h2>
        {totalShipments === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
            No shipments yet. They appear here as exporters send POs.
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 flex flex-col gap-2">
            {FUNNEL.filter((f) => (byStatus.get(f.status) ?? 0) > 0).map((f) => {
              const c = byStatus.get(f.status) ?? 0;
              return (
                <div key={f.status} className="flex items-center gap-3 text-sm">
                  <div className="w-36 shrink-0 text-zinc-600">{f.label}</div>
                  <div className="flex-1 bg-zinc-100 rounded h-5 overflow-hidden">
                    <div className={`h-full ${f.bar}`} style={{ width: `${Math.max(4, (c / maxCount) * 100)}%` }} />
                  </div>
                  <div className="w-8 text-right font-medium text-zinc-700">{c}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

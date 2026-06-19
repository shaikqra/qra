import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCustomerByPortalToken, portalRateLimited } from "@/lib/portal/auth";
import { getOrCreateInboundToken, inboundAddressFor } from "@/lib/email/inbound";
import { PORTAL_STAGES, portalStageIndex, portalActionHint, portalStopped } from "@/lib/portal/stages";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  reference_number: string;
  status: string;
  created_at: string;
  extracted_data: Record<string, unknown> | null;
};

function field(d: Record<string, unknown> | null, k: string): string {
  const v = d?.[k];
  return typeof v === "string" ? v.trim() : "";
}

function goodsLine(d: Record<string, unknown> | null): string {
  const product = field(d, "product_description") || "Goods";
  const buyer = field(d, "buyer_name");
  return buyer ? `${product} · ${buyer}` : product;
}

function stageLabel(status: string): string {
  if (portalStopped(status)) return "Stopped";
  const i = portalStageIndex(status);
  return PORTAL_STAGES[i]?.label ?? "In progress";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

export default async function PortalHome({ params }: { params: Promise<{ token: string }> }) {
  if (portalRateLimited(await clientIp())) {
    return <p className="text-sm text-slate-500">Too many requests — please wait a moment and refresh.</p>;
  }

  const { token } = await params;
  const customer = await resolveCustomerByPortalToken(token);
  if (!customer) notFound();

  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("shipments")
    .select("id, reference_number, status, created_at, extracted_data")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Row[];

  // The exporter's own PO email address — shown in the empty state so they know
  // they can forward a PO by email too, not only WhatsApp.
  const poEmail =
    rows.length === 0
      ? await getOrCreateInboundToken(customer.id).then((t) => (t ? inboundAddressFor(t) : null))
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {customer.display_name?.trim() || "Your shipments"}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Every shipment Qra is preparing for you. Tap one to see its progress and documents.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div className="text-base font-semibold text-slate-800">No shipments yet</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Your orders appear here automatically. Send one to Qra on WhatsApp, or use your dedicated
            purchase-order inbox:
          </p>
          {poEmail && (
            <>
              <div className="mx-auto mt-3 inline-block rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm text-slate-800">
                {poEmail}
              </div>
              <p className="mx-auto mt-3 max-w-md text-xs text-slate-400">
                Give this address to your buyers so their purchase orders arrive straight in — or forward
                orders you&apos;ve already received.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const hint = portalActionHint(r.status);
            return (
              <Link
                key={r.id}
                href={`/portal/${token}/${r.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-[#3f5bd9] hover:bg-[#eef1fc] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900">{r.reference_number}</span>
                  <span className="ml-auto text-xs font-semibold text-[#3f5bd9]">{stageLabel(r.status)}</span>
                </div>
                <div className="text-sm text-slate-600 mt-1">{goodsLine(r.extracted_data)}</div>
                {hint && <div className="text-xs text-amber-700 mt-1.5 font-medium">{hint}</div>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

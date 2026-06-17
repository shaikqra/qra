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
    return <p className="text-sm text-zinc-500">Too many requests — please wait a moment and refresh.</p>;
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
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          {customer.display_name?.trim() || "Your shipments"}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Every shipment Qra is preparing for you. Tap one to see its progress and documents.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          <div className="font-medium text-zinc-700">No shipments yet.</div>
          <div className="mt-1.5">
            Send a purchase order to Qra on WhatsApp
            {poEmail ? (
              <>
                , or forward it (e.g. straight from your buyer&apos;s email) to{" "}
                <span className="font-mono text-zinc-700">{poEmail}</span>
              </>
            ) : null}{" "}
            — and it&apos;ll appear here.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const hint = portalActionHint(r.status);
            return (
              <Link
                key={r.id}
                href={`/portal/${token}/${r.id}`}
                className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-zinc-900">{r.reference_number}</span>
                  <span className="ml-auto text-xs font-semibold text-emerald-700">{stageLabel(r.status)}</span>
                </div>
                <div className="text-sm text-zinc-600 mt-1">{goodsLine(r.extracted_data)}</div>
                {hint && <div className="text-xs text-amber-700 mt-1.5 font-medium">{hint}</div>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

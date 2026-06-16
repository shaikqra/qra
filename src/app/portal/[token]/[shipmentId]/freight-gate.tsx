"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portalAwardFreight, portalNegotiateFreight, portalRejectFreightQuote } from "./actions";
import type { RankedQuote, FreightQuote } from "@/lib/freight/rank-quotes";

type Result = { ok: true } | { ok: false; error: string };

// The G4 gate, in the exporter's own console (Build Bible: G4 is the exporter's).
// The Freight agent recommends the best quote; the exporter accepts, negotiates,
// or rejects. Booking happens off-platform — Qra never moves money.
export function FreightGate({
  token,
  shipmentId,
  quotes,
  awarded,
  recommendationId,
  reason,
}: {
  token: string;
  shipmentId: string;
  quotes: RankedQuote[];
  awarded: FreightQuote | null;
  recommendationId: string | null;
  reason: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<Result>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  // Nothing to surface until the agent has quotes (or a decision).
  if (!awarded && quotes.length === 0) return null;

  const fmtRate = (q: RankedQuote | FreightQuote) =>
    q.rateAmount !== null ? `${q.rateCurrency} ${q.rateAmount}`.trim() : "—";

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Freight</h2>

      {awarded ? (
        <div className="rounded-xl border-2 border-emerald-500 bg-white p-4">
          <div className="text-sm font-semibold text-emerald-900">
            ✓ Carrier awarded: {awarded.carrierName || "your carrier"}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Rate {fmtRate(awarded)}
            {awarded.transitDays !== null ? ` · ${awarded.transitDays}-day transit` : ""}. Your forwarder
            handles the booking from here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-emerald-500 bg-white p-4">
          <div className="text-sm font-semibold text-zinc-900">Choose your carrier</div>
          {reason && <p className="mt-1 text-xs text-emerald-800">{reason}</p>}

          <div className="mt-3 flex flex-col gap-2">
            {quotes.map((q) => (
              <div
                key={q.id}
                className={`rounded-lg border p-3 ${
                  q.id === recommendationId ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-900">
                    {q.carrierName || "Carrier"}
                    {q.id === recommendationId && (
                      <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        RECOMMENDED
                      </span>
                    )}
                    {q.decision === "negotiate" && (
                      <span className="ml-2 text-[11px] font-semibold text-amber-700">
                        negotiating{q.negotiateTarget !== null ? ` → target ${q.rateCurrency} ${q.negotiateTarget}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-700">
                    {fmtRate(q)}
                    {q.transitDays !== null ? ` · ${q.transitDays}d transit` : ""}
                    {q.freeDays !== null ? ` · ${q.freeDays} free days` : ""}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    disabled={pending}
                    onClick={() => run(() => portalAwardFreight(token, shipmentId, q.id))}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Accept
                  </button>
                  <button
                    disabled={pending || q.rateAmount === null || q.decision === "negotiate"}
                    onClick={() => run(() => portalNegotiateFreight(token, shipmentId, q.id))}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Negotiate
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => run(() => portalRejectFreightQuote(token, shipmentId, q.id))}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </section>
  );
}

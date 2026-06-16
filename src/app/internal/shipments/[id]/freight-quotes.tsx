"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addFreightQuoteAction, draftCounterAction, sendFreightRfqAction } from "./freight-actions";
import type { RankedQuote, FreightQuote } from "@/lib/freight/rank-quotes";

// Counter-offer to a carrier whose quote the exporter chose to negotiate. The
// agent drafts it at the x0.985 target; the operator reviews and sends it (the
// same audited send path as the RFQ).
function CounterOffer({ shipmentId, quote }: { shipmentId: string; quote: RankedQuote }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [carrier, setCarrier] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function draftIt() {
    setError(null);
    setSent(false);
    start(async () => {
      const r = await draftCounterAction(shipmentId, quote.id);
      if (r.ok) setDraft(r.draft);
      else setError(r.error);
    });
  }

  function send() {
    if (!draft) return;
    setError(null);
    start(async () => {
      const r = await sendFreightRfqAction(shipmentId, carrier, draft.subject, draft.body);
      if (r.ok) {
        setSent(true);
        if (r.warning) setError(r.warning);
      } else setError(r.error);
    });
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="text-[11px] font-semibold text-amber-900">
        Counter-offer to {quote.carrierName || "carrier"}
        {quote.negotiateTarget !== null ? ` → target ${quote.rateCurrency} ${quote.negotiateTarget}` : ""}
      </div>
      {!draft ? (
        <button
          onClick={draftIt}
          disabled={pending}
          className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          {pending ? "Drafting…" : "Draft counter-offer"}
        </button>
      ) : (
        <div className="mt-2 rounded-md border border-amber-200 bg-white p-2.5">
          <div className="text-[11px] font-semibold text-zinc-700">Subject: {draft.subject}</div>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-zinc-700">
            {draft.body}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={carrier}
              onChange={(e) => {
                setCarrier(e.target.value);
                setSent(false);
              }}
              placeholder="carrier@example.com"
              className="flex-1 min-w-[160px] rounded-md border border-zinc-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              onClick={send}
              disabled={pending || !carrier.trim()}
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send counter"}
            </button>
            {sent && <span className="text-[11px] font-semibold text-emerald-700">Sent ✓</span>}
          </div>
        </div>
      )}
      {error && <div className="mt-1 text-[11px] text-red-600">{error}</div>}
    </div>
  );
}

// Carrier quotes + ranking. Operator pastes a carrier reply; the Freight agent
// parses it and the quotes are ranked. The Accept/Negotiate/Reject decision (G4)
// is the EXPORTER's, in their portal — this view is read-only ranking + status.
export function FreightQuotes({
  shipmentId,
  quotes,
  awarded,
  recommendationId,
  reason,
}: {
  shipmentId: string;
  quotes: RankedQuote[];
  awarded: FreightQuote | null;
  recommendationId: string | null;
  reason: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    start(async () => {
      const r = await addFreightQuoteAction(shipmentId, raw);
      if (r.ok) {
        setRaw("");
        router.refresh();
      } else setError(r.error);
    });
  }

  const fmtRate = (q: RankedQuote) =>
    q.rateAmount !== null ? `${q.rateCurrency} ${q.rateAmount}`.trim() : "—";

  return (
    <div className="mt-3 rounded-md border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-800">Carrier quotes &amp; ranking</h3>
      <p className="mt-0.5 max-w-xl text-xs text-zinc-500">
        Paste a carrier&apos;s reply; the Freight agent reads the rate, transit and free days, then ranks
        the quotes. The recommendation is the exporter&apos;s call at G4.
      </p>

      {awarded && (
        <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          ✓ Freight awarded: {awarded.carrierName || "carrier"}
          {awarded.rateAmount !== null ? ` — ${awarded.rateCurrency} ${awarded.rateAmount}` : ""}
        </div>
      )}

      {quotes.length > 0 && (
        <>
          {reason && (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              {reason}
            </div>
          )}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-zinc-400">
                <tr>
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">Carrier</th>
                  <th className="py-1 pr-2 font-medium">Rate</th>
                  <th className="py-1 pr-2 font-medium">Transit</th>
                  <th className="py-1 pr-2 font-medium">Free days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {quotes.map((q) => (
                  <tr key={q.id} className={q.id === recommendationId ? "bg-emerald-50" : ""}>
                    <td className="py-1.5 pr-2 text-zinc-500">{q.rank}</td>
                    <td className="py-1.5 pr-2 font-medium text-zinc-800">
                      {q.carrierName || "—"}
                      {q.id === recommendationId && <span className="ml-1 text-emerald-700">★</span>}
                      {q.decision === "negotiate" && (
                        <span className="ml-1 text-[10px] font-semibold text-amber-700">
                          negotiating{q.negotiateTarget !== null ? ` → ${q.rateCurrency} ${q.negotiateTarget}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-zinc-700">{fmtRate(q)}</td>
                    <td className="py-1.5 pr-2 text-zinc-700">{q.transitDays !== null ? `${q.transitDays}d` : "—"}</td>
                    <td className="py-1.5 pr-2 text-zinc-700">{q.freeDays !== null ? `${q.freeDays}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {quotes.filter((q) => q.decision === "negotiate").length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {quotes
                .filter((q) => q.decision === "negotiate")
                .map((q) => (
                  <CounterOffer key={q.id} shipmentId={shipmentId} quote={q} />
                ))}
            </div>
          )}
        </>
      )}

      <div className="mt-3 border-t border-zinc-200 pt-3">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste a carrier's quote reply here…"
          rows={3}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={add}
            disabled={pending || !raw.trim()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {pending ? "Reading…" : "Add quote"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}

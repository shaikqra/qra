"use client";

import { useState, useTransition } from "react";
import { draftFreightRfqAction, sendFreightRfqAction } from "./freight-actions";

// Freight agent (G4) — first capability: draft a carrier RFQ from the shipment.
// The operator reviews it and emails it to their carriers. Send → parse quote
// replies → rank → the G4 award gate are the next builds.
export function FreightPanel({ shipmentId }: { shipmentId: string }) {
  const [pending, start] = useTransition();
  const [rfq, setRfq] = useState<{ subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [sent, setSent] = useState(false);

  function run() {
    setError(null);
    setCopied(false);
    setSent(false);
    start(async () => {
      const r = await draftFreightRfqAction(shipmentId);
      if (r.ok) setRfq(r.rfq);
      else setError(r.error);
    });
  }

  function send() {
    if (!rfq) return;
    setError(null);
    start(async () => {
      const r = await sendFreightRfqAction(shipmentId, carrier, rfq.subject, rfq.body);
      if (r.ok) {
        setSent(true);
        if (r.warning) setError(r.warning);
      } else setError(r.error);
    });
  }

  async function copy() {
    if (!rfq) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${rfq.subject}\n\n${rfq.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Freight agent — draft carrier RFQ (G4)</h3>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-xl">
            Drafts a Request for Quotation from this shipment&apos;s cargo. Review it, then email it to your
            carriers. Qra books nothing — you stay in control.
          </p>
        </div>
        <button
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Drafting…" : "Draft RFQ"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      {rfq && (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-zinc-700">Subject: {rfq.subject}</div>
            <button onClick={copy} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-700">
            {rfq.body}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3">
            <input
              type="email"
              value={carrier}
              onChange={(e) => {
                setCarrier(e.target.value);
                setSent(false);
              }}
              placeholder="carrier@example.com"
              className="flex-1 min-w-[180px] rounded-md border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              onClick={send}
              disabled={pending || !carrier.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send RFQ"}
            </button>
            {sent && <span className="text-xs font-semibold text-emerald-700">Sent ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

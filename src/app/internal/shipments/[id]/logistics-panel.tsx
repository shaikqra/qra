"use client";

import { useState, useTransition } from "react";
import { draftBookingAction } from "./logistics-actions";

// Logistics agent — first capability: draft an inland booking request (truck /
// container / CFS / VGM). The operator reviews and emails it. Draft only.
export function LogisticsPanel({ shipmentId }: { shipmentId: string }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function run() {
    setError(null);
    setCopied(false);
    start(async () => {
      const r = await draftBookingAction(shipmentId);
      if (r.ok) setDraft(r.draft);
      else setError(r.error);
    });
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Logistics agent — draft booking request</h3>
          <p className="mt-0.5 max-w-xl text-xs text-zinc-500">
            Drafts a transporter / CFS booking request (truck → port, container, CFS slot, VGM) from this
            shipment&apos;s cargo. Review, then email it. Qra books nothing.
          </p>
        </div>
        <button
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Drafting…" : "Draft booking"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      {draft && (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-zinc-700">Subject: {draft.subject}</div>
            <button onClick={copy} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-700">
            {draft.body}
          </pre>
        </div>
      )}
    </div>
  );
}

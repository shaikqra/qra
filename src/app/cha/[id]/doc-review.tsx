"use client";

import { useState, useTransition } from "react";
import { runDocumentReview } from "./review-actions";
import type { DocReviewFlag } from "@/lib/ai/review-documents";

const SEV: Record<string, { box: string; badge: string }> = {
  high: { box: "border-red-200 bg-red-50", badge: "bg-red-100 text-red-700" },
  medium: { box: "border-amber-200 bg-amber-50", badge: "bg-amber-100 text-amber-800" },
  low: { box: "border-zinc-200 bg-zinc-50", badge: "bg-zinc-100 text-zinc-600" },
};

export function DocReview({ shipmentId }: { shipmentId: string }) {
  const [pending, startTransition] = useTransition();
  const [flags, setFlags] = useState<DocReviewFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const r = await runDocumentReview(shipmentId);
      if (r.ok) setFlags(r.flags);
      else setError(r.error);
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-800">Qra document check</div>
          <div className="text-xs text-zinc-500">
            AI scan for data discrepancies to verify before filing — advisory, and it checks data
            consistency, not regulatory requirements. Your call as the broker.
          </div>
        </div>
        <button
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Checking…" : flags ? "Re-check" : "Run check"}
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {flags && flags.length === 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ No data discrepancies found. Still your call as the broker.
        </div>
      )}

      {flags && flags.length > 0 && (
        <ul className="flex flex-col gap-2">
          {flags.map((f, i) => {
            const sev = SEV[f.severity] ?? SEV.medium;
            return (
              <li key={i} className={`rounded-md border px-3 py-2 text-sm ${sev.box}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${sev.badge}`}>
                    {f.severity}
                  </span>
                  <span className="font-semibold text-zinc-800">{f.field}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-400">
                    {f.source === "rule" ? "rule" : "AI"}
                  </span>
                </div>
                <div className="text-zinc-700 mt-1">{f.issue}</div>
                {f.suggestion && (
                  <div className="text-zinc-500 mt-0.5">Suggested: {f.suggestion}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

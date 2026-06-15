"use client";

import { useState, useTransition } from "react";
import { runDocumentReview } from "./review-actions";
import type { DocReviewFlag } from "@/lib/ai/review-documents";

// The §12 review surface: documents as cards on the left, a live in-app preview
// on the right, and the AI's data-consistency flags pinned above. (This increment
// is review-only; the conversational "apply correction" loop comes next.)

const SEV: Record<string, { box: string; badge: string }> = {
  high: { box: "border-red-200 bg-red-50", badge: "bg-red-100 text-red-700" },
  medium: { box: "border-amber-200 bg-amber-50", badge: "bg-amber-100 text-amber-800" },
  low: { box: "border-zinc-200 bg-zinc-50", badge: "bg-zinc-100 text-zinc-600" },
};

type DocFile = { label: string; url: string };

export function DocWorkspace({ files, shipmentId }: { files: DocFile[]; shipmentId: string }) {
  const [selected, setSelected] = useState<DocFile | null>(files[0] ?? null);
  const [pending, startTransition] = useTransition();
  const [flags, setFlags] = useState<DocReviewFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runCheck() {
    setError(null);
    startTransition(async () => {
      const r = await runDocumentReview(shipmentId);
      if (r.ok) setFlags(r.flags);
      else setError(r.error);
    });
  }

  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
        No documents on this shipment yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* AI check bar */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-800">Qra document check</div>
            <div className="text-xs text-zinc-500">
              AI scan for data discrepancies across the set — advisory. It checks data consistency,
              not regulatory requirements. Your call as the broker.
            </div>
          </div>
          <button
            onClick={runCheck}
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
                  {f.suggestion && <div className="text-zinc-500 mt-0.5">Suggested: {f.suggestion}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* cards + preview */}
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
          {files.map((f) => {
            const on = selected?.label === f.label;
            return (
              <button
                key={f.label}
                onClick={() => setSelected(f)}
                className={`flex shrink-0 items-center gap-2 rounded-xl border p-3 text-left text-sm transition-colors md:shrink ${
                  on
                    ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                    : "border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50"
                }`}
              >
                <span className="text-lg">📄</span>
                <span className="font-semibold text-zinc-800">{f.label}</span>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-3 py-2">
                <span className="text-sm font-semibold text-emerald-800">{selected.label}</span>
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-zinc-500 hover:text-zinc-900"
                >
                  Open in new tab ↗
                </a>
              </div>
              <object data={selected.url} type="application/pdf" className="h-[70vh] w-full bg-zinc-100">
                <div className="p-6 text-sm text-zinc-500">
                  Preview isn&apos;t available in this browser —{" "}
                  <a href={selected.url} target="_blank" rel="noopener noreferrer" className="underline">
                    open the document
                  </a>
                  .
                </div>
              </object>
            </>
          ) : (
            <div className="p-6 text-sm text-zinc-500">Pick a document to preview.</div>
          )}
        </div>
      </div>
    </div>
  );
}

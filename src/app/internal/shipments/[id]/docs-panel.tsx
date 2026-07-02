"use client";

import { useState, useTransition } from "react";
import { checkRequiredDocsAction } from "./docs-actions";
import type { RequiredDoc } from "@/lib/ai/required-docs-agent";

// Required-Documents agent — list the extra documents this shipment likely needs
// beyond Qra's standard set (advisory; the agent issues/files nothing). Operator-side
// on-demand check; the auto-pipeline also runs this and surfaces it to the exporter.
export function DocsPanel({ shipmentId }: { shipmentId: string }) {
  const [pending, start] = useTransition();
  const [docs, setDocs] = useState<RequiredDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      const r = await checkRequiredDocsAction(shipmentId);
      if (r.ok) setDocs(r.docs);
      else setError(r.error);
    });
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Required-Documents agent — extra documents</h3>
          <p className="mt-0.5 max-w-xl text-xs text-zinc-500">
            Lists the documents this product + destination likely needs <span className="font-medium">beyond Qra&apos;s
            standard set</span> (invoice, packing list, CoO, export declaration), and who issues each.
            Advisory — Qra issues/files nothing. This list <span className="font-medium">can miss a document your
            shipment needs</span>; treat it as a starting point and have your CHA/buyer confirm the full list before you ship.
          </p>
        </div>
        <button
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Checking…" : "Check documents"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      {docs && (
        <div className="mt-3">
          {docs.length === 0 ? (
            <div className="text-xs text-zinc-500">No extra documents flagged for this product + destination.</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {docs.map((c, i) => (
                <li key={i} className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-800">{c.name}</span>
                    {c.issuedBy && <span className="text-[11px] text-zinc-500">issued by {c.issuedBy}</span>}
                  </div>
                  {c.note && <div className="mt-0.5 text-[11px] text-zinc-600">{c.note}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-amber-700">
            ⚠️ This can miss a document your shipment legally needs — a missing one can get your container held
            at port. A starting point, not a checklist: your CHA/buyer must confirm the full list before you ship.
          </p>
        </div>
      )}
    </div>
  );
}

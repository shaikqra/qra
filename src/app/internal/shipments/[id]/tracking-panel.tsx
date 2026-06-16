"use client";

import { useState, useTransition } from "react";
import { assessStatusAction } from "./tracking-actions";
import type { ShipmentStatus } from "@/lib/ai/tracking-agent";

// Tracking agent — read a carrier status update into a clean status + ETA, with a
// demurrage-risk flag. Advisory; reads, never acts. Operator-side for now.
export function TrackingPanel({ shipmentId }: { shipmentId: string }) {
  const [pending, start] = useTransition();
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<ShipmentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      const r = await assessStatusAction(shipmentId, raw);
      if (r.ok) setStatus(r.status);
      else setError(r.error);
    });
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-800">Tracking agent — read a carrier update</h3>
      <p className="mt-0.5 max-w-xl text-xs text-zinc-500">
        Paste a carrier status / tracking update; the agent reads it into a clean status + ETA and flags
        demurrage risk against the awarded carrier&apos;s free days. Advisory — it watches, it doesn&apos;t act.
      </p>

      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setStatus(null);
        }}
        placeholder="Paste the carrier's status update here…"
        rows={3}
        className="mt-3 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={run}
          disabled={pending || !raw.trim()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Reading…" : "Read status"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {status && (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="text-xs font-semibold text-zinc-800">{status.summary}</div>
          <div className="mt-1 grid grid-cols-1 gap-0.5 text-[11px] text-zinc-600 sm:grid-cols-3">
            {status.vessel && <div><span className="text-zinc-400">Vessel:</span> {status.vessel}</div>}
            {status.milestone && <div><span className="text-zinc-400">Status:</span> {status.milestone}</div>}
            {status.eta && <div><span className="text-zinc-400">ETA:</span> {status.eta}</div>}
          </div>
          {status.riskNote && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              ⚠️ {status.riskNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

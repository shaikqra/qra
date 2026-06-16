"use client";

import { useState, useTransition } from "react";
import { checkLcAction } from "./lc-actions";
import type { LcDiscrepancy } from "@/lib/ai/lc-check";

const SEV_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

// LC / UCP-600 discrepancy check. Paste the LC terms; the agent flags where the
// shipment's documents would not comply. Advisory pre-check — the bank is the
// authority. Operator-only for now (high stakes); never auto-fixes.
export function LcPanel({ shipmentId }: { shipmentId: string }) {
  const [pending, start] = useTransition();
  const [lc, setLc] = useState("");
  const [result, setResult] = useState<LcDiscrepancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      const r = await checkLcAction(shipmentId, lc);
      if (r.ok) setResult(r.discrepancies);
      else setError(r.error);
    });
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-800">LC check — discrepancies (UCP 600)</h3>
      <p className="mt-0.5 max-w-xl text-xs text-zinc-500">
        Paste the buyer&apos;s Letter of Credit terms; the agent flags mismatches Qra can see in the shipment
        data, so you fix them <span className="font-medium">before</span> presenting to the bank. A partial
        pre-check — your bank is the final authority.
      </p>

      <textarea
        value={lc}
        onChange={(e) => {
          setLc(e.target.value);
          setResult(null);
        }}
        placeholder="Paste the Letter of Credit terms here…"
        rows={4}
        className="mt-3 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={run}
          disabled={pending || !lc.trim()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Examining…" : "Check against LC"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {result && (
        <div className="mt-3">
          {result.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <span className="font-semibold">✓ No mismatch in the data Qra checked</span> — names, amount, goods,
              incoterm, ports, HS, quantity, weights.
            </div>
          ) : (
            <>
              <div className="text-xs font-semibold text-zinc-700">
                {result.length} discrepanc{result.length === 1 ? "y" : "ies"} to resolve before presentation:
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {result.map((x, i) => (
                  <li key={i} className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-800">{x.field}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${SEV_STYLE[x.severity]}`}>
                        {x.severity}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-600">
                      <span className="font-medium text-zinc-700">LC requires:</span> {x.lcRequires || "—"}
                    </div>
                    <div className="text-[11px] text-zinc-600">
                      <span className="font-medium text-zinc-700">Documents show:</span> {x.documentsShow || "—"}
                    </div>
                    {x.suggestion && (
                      <div className="mt-1 text-[11px] text-emerald-800">
                        <span className="font-medium">Fix:</span> {x.suggestion}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* Shown on BOTH paths — a clean result is NOT a clean bill of health. */}
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <span className="font-semibold">⚠️ NOT checked — verify these by hand:</span> shipment / expiry /
            presentation dates; whether every required document is present; exact wording matching across
            documents. These cause most LC rejections and Qra can&apos;t see them yet — your bank is the final authority.
          </div>
        </div>
      )}
    </div>
  );
}

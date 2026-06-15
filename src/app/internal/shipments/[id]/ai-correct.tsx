"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyAiCorrection, checkShipmentDocs } from "./correct-actions";
import type { DocReviewFlag } from "@/lib/ai/review-documents";

// §12 review-and-correct loop on the operator's pre-approval surface: run the AI
// check, then fix a flagged issue in one tap or type your own instruction — Qra
// redrafts the field and regenerates the documents (re-screening parties /
// re-validating first; never on an already-approved pack).

const SEV: Record<string, { box: string; badge: string }> = {
  high: { box: "border-red-200 bg-red-50", badge: "bg-red-100 text-red-700" },
  medium: { box: "border-amber-200 bg-amber-50", badge: "bg-amber-100 text-amber-800" },
  low: { box: "border-zinc-200 bg-zinc-50", badge: "bg-zinc-100 text-zinc-600" },
};

type Done = { field: string; oldValue: string; newValue: string; note?: string };

export function AiCorrect({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [checking, startCheck] = useTransition();
  const [flags, setFlags] = useState<DocReviewFlag[] | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  function check() {
    setError(null);
    startCheck(async () => {
      const r = await checkShipmentDocs(shipmentId);
      if (r.ok) setFlags(r.flags);
      else setError(r.error);
    });
  }

  function apply(instruction: string) {
    const ins = instruction.trim();
    if (!ins) return;
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await applyAiCorrection(shipmentId, ins);
      if (r.ok) {
        setDone({ field: r.field, oldValue: r.oldValue, newValue: r.newValue, note: r.note });
        setText("");
        const rc = await checkShipmentDocs(shipmentId);
        if (rc.ok) setFlags(rc.flags);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-800">Review &amp; fix documents with Qra</div>
          <p className="text-xs text-zinc-500">
            Run the AI check, then apply a flagged fix in one tap — or type your own. Qra redrafts the
            field and regenerates the documents. Only before the customer approves.
          </p>
        </div>
        <button
          onClick={check}
          disabled={checking}
          className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {checking ? "Checking…" : flags ? "Re-check" : "Run check"}
        </button>
      </div>

      {flags && flags.length === 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ No data discrepancies found.
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
                  <button
                    onClick={() => apply(`Fix the "${f.field}": ${f.issue}. ${f.suggestion}`)}
                    disabled={pending}
                    className="ml-auto rounded bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {pending ? "…" : "Apply"}
                  </button>
                </div>
                <div className="text-zinc-700 mt-1">{f.issue}</div>
                {f.suggestion && <div className="text-zinc-500 mt-0.5">Suggested: {f.suggestion}</div>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply(text);
          }}
          placeholder={'Or type a fix — e.g. "set HS code to 1207.40"'}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
        />
        <button
          onClick={() => apply(text)}
          disabled={pending || !text.trim()}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Fixing…" : "Apply fix"}
        </button>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}
      {done && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            done.note
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          ✓ Updated <b>{done.field}</b>: <span className="line-through opacity-60">{done.oldValue || "—"}</span> →{" "}
          <b>{done.newValue}</b>. {done.note ?? "Documents regenerated."}
        </div>
      )}
    </div>
  );
}

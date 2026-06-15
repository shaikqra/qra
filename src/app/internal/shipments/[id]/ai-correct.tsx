"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyAiCorrection } from "./correct-actions";

// §12 review loop (operator side, pre-approval): the reviewer types a plain
// instruction; Qra redrafts the matching field and regenerates the documents.
export function AiCorrect({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<{
    field: string;
    oldValue: string;
    newValue: string;
    note?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const instruction = text.trim();
    if (!instruction) return;
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await applyAiCorrection(shipmentId, instruction);
      if (r.ok) {
        setDone({ field: r.field, oldValue: r.oldValue, newValue: r.newValue, note: r.note });
        setText("");
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-2">
      <div className="text-sm font-semibold text-zinc-800">Fix a document field with Qra</div>
      <p className="text-xs text-zinc-500">
        Tell Qra what to change in plain words — e.g. &ldquo;set HS code to 1207.40&rdquo; or
        &ldquo;buyer should be Hanseatic Foods GmbH&rdquo;. Qra redrafts that field and regenerates
        the documents. Only available before the customer approves.
      </p>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
          placeholder="What should change?"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
        />
        <button
          onClick={apply}
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

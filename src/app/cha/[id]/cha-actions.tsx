"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chaMarkFiled, chaRequestChanges } from "./actions";

export function ChaActions({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: (id: string, note: string) => Promise<{ ok: boolean; error?: string }>, needNote: boolean) {
    setError(null);
    if (needNote && !note.trim()) {
      setError("Please describe the change needed.");
      return;
    }
    startTransition(async () => {
      const r = await fn(shipmentId, note);
      if (r.ok) router.refresh();
      else setError(r.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-3">
      <div className="text-sm font-semibold text-zinc-800">Once you&apos;ve reviewed the pack</div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Optional note — or, to request changes, say what needs fixing"
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
      />
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run(chaMarkFiled, false)}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Mark as filed with customs"}
        </button>
        <button
          onClick={() => run(chaRequestChanges, true)}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Request changes
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <p className="text-xs text-zinc-400">
        &ldquo;Filed&rdquo; records that you filed the shipping bill on ICEGATE with your own DSC. Qra
        never holds your signature.
      </p>
    </div>
  );
}

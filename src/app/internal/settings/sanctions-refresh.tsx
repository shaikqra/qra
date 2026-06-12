"use client";

import { useState, useTransition } from "react";
import { refreshSanctionsLists } from "./actions";

export function SanctionsRefresh() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
        Denied-party lists
      </h2>
      <p className="text-sm text-zinc-600 mb-3 max-w-2xl">
        Buyers are screened against the US Consolidated Screening List (live) and the
        UN Security Council Consolidated List (loaded here). Refresh weekly to keep the UN
        list current — until it&apos;s loaded, shipments wait in sanctions review.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const r = await refreshSanctionsLists();
              setMessage(
                r.ok
                  ? { ok: true, text: `Loaded ${r.count} UN entries.` }
                  : { ok: false, text: r.error }
              );
            });
          }}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Refreshing…" : "Refresh UN list"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}

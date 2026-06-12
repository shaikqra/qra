"use client";

import { useState, useTransition } from "react";
import { setAutoSendCha } from "./actions";

export function AutoChaToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
        Customs-broker handoff
      </h2>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-zinc-600 max-w-2xl">
          {enabled ? (
            <>
              <span className="font-medium text-zinc-800">Automatic.</span> When a customer
              approves, Qra emails the documents to their CHA on its own. Best once you trust the
              flow on real shipments.
            </>
          ) : (
            <>
              <span className="font-medium text-zinc-800">Pilot mode (you review).</span> When a
              customer approves, the shipment waits at &ldquo;customer approved&rdquo; for you to
              glance and click <span className="font-medium">Email to CHA</span>. Safer while the
              product is young.
            </>
          )}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={pending}
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            startTransition(async () => {
              const r = await setAutoSendCha(next);
              if (!r.ok) setEnabled(!next); // revert on failure
            });
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            enabled ? "bg-emerald-600" : "bg-zinc-300"
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </section>
  );
}

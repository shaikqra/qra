"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portalConfirmOrder, portalDeclineOrder, portalApproveDocs } from "./actions";

type Result = { ok: true } | { ok: false; error: string };

export function GateActions({
  token,
  shipmentId,
  status,
}: {
  token: string;
  shipmentId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<Result>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  if (status === "awaiting_order_confirm") {
    return (
      <div className="rounded-xl border-2 border-emerald-500 bg-white p-4">
        <div className="text-sm font-semibold text-zinc-900">Confirm this order?</div>
        <p className="text-xs text-zinc-500 mt-1">
          Confirming starts your export documents. Decline if this isn&apos;t an order to process.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            disabled={pending}
            onClick={() => run(() => portalConfirmOrder(token, shipmentId))}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "Working…" : "Confirm order"}
          </button>
          <button
            disabled={pending}
            onClick={() => run(() => portalDeclineOrder(token, shipmentId))}
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            Decline
          </button>
        </div>
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      </div>
    );
  }

  if (status === "awaiting_customer_approval") {
    return (
      <div className="rounded-xl border-2 border-emerald-500 bg-white p-4">
        <div className="text-sm font-semibold text-zinc-900">Approve your documents</div>
        <p className="text-xs text-zinc-500 mt-1">
          Review the documents below, then approve. Approving locks them and sends them to your CHA
          for filing.
        </p>
        <button
          disabled={pending}
          onClick={() => run(() => portalApproveDocs(token, shipmentId))}
          className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Approving…" : "Approve documents"}
        </button>
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      </div>
    );
  }

  return null;
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { operatorCloseShipment } from "./correct-actions";

const CLOSEABLE = ["filed_with_cha", "customs_cleared", "in_transit", "delivered"];

// G8 (operator side) — close a filed shipment from the dashboard.
export function CloseShipment({ shipmentId, status }: { shipmentId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!CLOSEABLE.includes(status)) return null;

  function run() {
    setError(null);
    start(async () => {
      const r = await operatorCloseShipment(shipmentId);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
      >
        {pending ? "Closing…" : "Close shipment (G8)"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

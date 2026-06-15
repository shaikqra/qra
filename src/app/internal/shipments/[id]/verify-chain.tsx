"use client";

import { useState, useTransition } from "react";
import { verifyAuditChain } from "./correct-actions";

// Proves the tamper-evident audit chain (§8) is intact for this shipment.
export function VerifyChain({ shipmentId }: { shipmentId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ intact: boolean; checked: number; brokenAt: number | null } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      const r = await verifyAuditChain(shipmentId);
      if (r.ok) setResult({ intact: r.intact, checked: r.checked, brokenAt: r.brokenAt });
      else setError(r.error);
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? "Verifying…" : "Verify audit trail"}
      </button>
      {result && (
        <span className={`text-xs font-semibold ${result.intact ? "text-emerald-700" : "text-red-600"}`}>
          {result.intact
            ? `✓ Intact — ${result.checked} sealed event${result.checked === 1 ? "" : "s"}, chain unbroken`
            : `✗ Tampering detected — chain breaks at event #${result.brokenAt ?? "?"}`}
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

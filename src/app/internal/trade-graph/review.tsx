"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyTradeGraphRule, rejectTradeGraphRule } from "./trade-graph-actions";

type Cert = { name?: string; note?: string; issuedBy?: string; issued_by?: string };
export type DraftRule = {
  id: string;
  rule_type: string;
  lane_key: string;
  payload: unknown;
  created_at: string;
};

type Result = { ok: true } | { ok: false; error: string };

function certs(payload: unknown): Cert[] {
  return Array.isArray(payload) ? (payload as Cert[]) : [];
}

function DraftCard({ rule }: { rule: DraftRule }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [citation, setCitation] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<Result>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  const list = certs(rule.payload);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-sm font-semibold text-zinc-900">{rule.lane_key}</div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-400">{rule.rule_type}</div>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {list.map((c, i) => (
          <li key={i} className="text-sm text-zinc-700">
            <span className="font-semibold">{c.name}</span>
            {c.note ? <span className="text-zinc-500"> — {c.note}</span> : null}
            {c.issuedBy || c.issued_by ? (
              <span className="text-[11px] text-zinc-400"> · {c.issuedBy ?? c.issued_by}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={citation}
          onChange={(e) => setCitation(e.target.value)}
          placeholder="Citation — the source this traces to (notification / circular / regulation)"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          disabled={pending}
          onClick={() => run(() => verifyTradeGraphRule(rule.id, citation))}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "…" : "Verify"}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => rejectTradeGraphRule(rule.id))}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}

export function TradeGraphReview({ drafts, verifiedCount }: { drafts: DraftRule[]; verifiedCount: number }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Trade Graph</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Verified rules: <span className="font-semibold text-emerald-700">{verifiedCount}</span>. Verify a draft once
          (with its source) and every future shipment on that lane uses it instantly.
        </p>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
          No drafts waiting. New lanes get drafted automatically as shipments run.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Drafts to verify ({drafts.length})
          </h2>
          {drafts.map((d) => (
            <DraftCard key={d.id} rule={d} />
          ))}
        </div>
      )}
    </div>
  );
}

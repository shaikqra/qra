"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyTradeGraphRule, rejectTradeGraphRule } from "./trade-graph-actions";

type Cert = { name: string; note: string; issuedBy: string };
export type DraftRule = {
  id: string;
  rule_type: string;
  lane_key: string;
  payload: unknown;
  created_at: string;
};

type Result = { ok: true } | { ok: false; error: string };

// Friendly labels for the rule types the Trade Graph holds. Both share the same
// {name, note, issuedBy} row shape, so one card verifies either kind — only the
// heading changes. Unknown types fall back to the raw rule_type string.
const RULE_TYPE_LABELS: Record<string, string> = {
  required_certs: "Certificates",
  required_docs: "Required documents",
};

function toRows(payload: unknown): Cert[] {
  const arr = Array.isArray(payload) ? payload : [];
  const rows = arr.map((c) => {
    const o = (c ?? {}) as { name?: unknown; note?: unknown; issuedBy?: unknown; issued_by?: unknown };
    return {
      name: String(o.name ?? "").trim(),
      note: String(o.note ?? "").trim(),
      issuedBy: String((o.issuedBy ?? o.issued_by) ?? "").trim(),
    };
  });
  return rows.length ? rows : [{ name: "", note: "", issuedBy: "" }];
}

function DraftCard({ rule }: { rule: DraftRule }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [citation, setCitation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Cert[]>(() => toRows(rule.payload));

  const setRow = (i: number, patch: Partial<Cert>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { name: "", note: "", issuedBy: "" }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  function run(fn: () => Promise<Result>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-sm font-semibold text-zinc-900">{rule.lane_key}</div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-400">
          {RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Edit the AI draft, then verify with its source.</p>

      <div className="mt-3 flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-zinc-200 p-2">
            <div className="flex gap-2">
              <input
                value={r.name}
                onChange={(e) => setRow(i, { name: e.target.value })}
                placeholder="Certificate / document name"
                className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <input
                value={r.issuedBy}
                onChange={(e) => setRow(i, { issuedBy: e.target.value })}
                placeholder="Issued by"
                className="w-40 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={() => removeRow(i)}
                aria-label="Remove"
                className="shrink-0 rounded-md border border-zinc-300 px-2 text-sm text-zinc-500 hover:bg-zinc-50"
              >
                ✕
              </button>
            </div>
            <input
              value={r.note}
              onChange={(e) => setRow(i, { note: e.target.value })}
              placeholder="Note — when / why it's needed"
              className="mt-1.5 w-full rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        ))}
        <button onClick={addRow} className="self-start text-xs font-semibold text-emerald-700 hover:text-emerald-800">
          + Add row
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={citation}
          onChange={(e) => setCitation(e.target.value)}
          placeholder="Citation — the source this traces to (notification / circular / regulation)"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          disabled={pending}
          onClick={() => run(() => verifyTradeGraphRule(rule.id, citation, rows))}
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
          Verified rules: <span className="font-semibold text-emerald-700">{verifiedCount}</span>. Edit a draft, verify
          it once with its source, and every future shipment on that lane uses it instantly.
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

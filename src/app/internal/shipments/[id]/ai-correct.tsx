"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyAiCorrection, checkShipmentDocs, checkHsCode } from "./correct-actions";
import type { DocReviewFlag } from "@/lib/ai/review-documents";
import { DocFacsimile, flaggedKeys } from "./doc-facsimile";

// §12 review-and-correct loop, as the cockpit shows it: a running CHAT. Run the AI
// check, see the document with flagged fields highlighted, then fix things by
// typing in plain English — Qra redrafts the field, regenerates the documents
// (re-screening / re-validating first), and the whole exchange stays in the
// conversation. Only before the customer approves; never on an approved pack.

const SEV: Record<string, { box: string; badge: string }> = {
  high: { box: "border-red-200 bg-red-50", badge: "bg-red-100 text-red-700" },
  medium: { box: "border-amber-200 bg-amber-50", badge: "bg-amber-100 text-amber-800" },
  low: { box: "border-zinc-200 bg-zinc-50", badge: "bg-zinc-100 text-zinc-600" },
};

type Tone = "ok" | "warn" | "info";
type Msg = { id: number; role: "you" | "qra"; text: string; tone?: Tone };

const QRA_TONE: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

export function AiCorrect({ shipmentId, data }: { shipmentId: string; data: Record<string, string> }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [checking, startCheck] = useTransition();
  const [hsPending, startHs] = useTransition();
  const [flags, setFlags] = useState<DocReviewFlag[] | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);

  function push(role: Msg["role"], text: string, tone?: Tone) {
    setLog((l) => [...l, { id: idRef.current++, role, text, tone }]);
  }

  function check() {
    setError(null);
    startCheck(async () => {
      const r = await checkShipmentDocs(shipmentId);
      if (!r.ok) return setError(r.error);
      setFlags(r.flags);
      push(
        "qra",
        r.flags.length === 0
          ? "✓ Checked — no data discrepancies."
          : `Found ${r.flags.length} thing${r.flags.length === 1 ? "" : "s"} to check: ${r.flags.map((f) => f.field).join(", ")}.`,
        r.flags.length === 0 ? "ok" : "info"
      );
    });
  }

  function hsCheck() {
    setError(null);
    startHs(async () => {
      const r = await checkHsCode(shipmentId);
      if (!r.ok) return setError(r.error);
      push(
        "qra",
        r.result.matches
          ? `✓ HS code ${r.result.current || "(none)"} looks right for the goods.`
          : `⚠ HS code may be off — I'd suggest ${r.result.suggested}. ${r.result.note} (type "set hs_code to ${r.result.suggested}" to apply)`,
        r.result.matches ? "ok" : "warn"
      );
    });
  }

  function apply(instruction: string) {
    const ins = instruction.trim();
    if (!ins) return;
    setError(null);
    push("you", ins);
    setText("");
    startTransition(async () => {
      const r = await applyAiCorrection(shipmentId, ins);
      if (r.ok) {
        push(
          "qra",
          `Changed ${r.field}: ${r.oldValue || "—"} → ${r.newValue}. ${r.note ?? "Documents regenerated."}`,
          r.note ? "warn" : "ok"
        );
        const rc = await checkShipmentDocs(shipmentId);
        if (rc.ok) setFlags(rc.flags);
        router.refresh();
      } else {
        push("qra", r.error, "warn");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-800">Review &amp; fix documents with Qra</div>
          <p className="text-xs text-zinc-500">
            Run a check, see flagged fields on the document, then just say what to fix — Qra redrafts the field +
            regenerates. Only before the customer approves.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={check}
            disabled={checking}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {checking ? "Checking…" : flags ? "Re-check" : "Run check"}
          </button>
          <button
            onClick={hsCheck}
            disabled={hsPending}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {hsPending ? "Checking…" : "Check HS code"}
          </button>
        </div>
      </div>

      {/* The conversation */}
      {log.length > 0 && (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg bg-zinc-50 p-3">
          {log.map((m) =>
            m.role === "you" ? (
              <div key={m.id} className="self-end rounded-lg rounded-br-sm bg-zinc-900 px-3 py-1.5 text-sm text-white">
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                className={`self-start rounded-lg rounded-bl-sm border px-3 py-1.5 text-sm ${QRA_TONE[m.tone ?? "info"]}`}
              >
                {m.text}
              </div>
            )
          )}
          {pending && <div className="self-start px-1 text-xs text-zinc-400">Qra is redrafting…</div>}
        </div>
      )}

      {/* Flags as one-tap cards (still the fastest path for a known issue) */}
      {flags && flags.length > 0 && (
        <ul className="flex flex-col gap-2">
          {flags.map((f, i) => {
            const sev = SEV[f.severity] ?? SEV.medium;
            return (
              <li key={i} className={`rounded-md border px-3 py-2 text-sm ${sev.box}`}>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sev.badge}`}>
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
                <div className="mt-1 text-zinc-700">{f.issue}</div>
                {f.suggestion && <div className="mt-0.5 text-zinc-500">Suggested: {f.suggestion}</div>}
              </li>
            );
          })}
        </ul>
      )}

      {flags && <DocFacsimile data={data} flagged={flaggedKeys(flags)} />}

      {/* The single chat input */}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply(text);
          }}
          placeholder={'Tell Qra what to fix — e.g. "change the buyer to Acme GmbH" or "set HS code to 1207.40"'}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
        />
        <button
          onClick={() => apply(text)}
          disabled={pending || !text.trim()}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Fixing…" : "Send"}
        </button>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}

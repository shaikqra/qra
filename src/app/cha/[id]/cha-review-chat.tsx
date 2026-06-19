"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runDocumentReview } from "./review-actions";
import { chaApplyCorrection, chaApproveDocs } from "./cha-correct-actions";
import { chaMarkFiled, chaRequestChanges } from "./actions";
import type { DocReviewFlag } from "@/lib/ai/review-documents";

// The CHA's review-and-correct surface (Build Bible §12.3 — "the most distinctive
// surface"). Documents appear as cards in the chat feed; tapping Preview floats a
// zoom panel on the right; the broker corrects conversationally in the single
// input and the owning agent redrafts the field + regenerates the pack; then a
// forgiving Approve (G5) and File & sign (G6). Brand blue, matching the exporter
// console.
//
// IMMUTABILITY (Build Bible §8): the exporter already approved & locked the pack
// before it reached the broker, so a broker correction un-approves it and bounces
// it back to the exporter to re-approve. While it's away (or held for a re-check),
// the surface goes read-only and says so. Honest deviations from the literal
// cockpit: field highlights surface as callouts (not pixel-overlaid on the PDF),
// and the regenerated PDF lands in a few seconds (the chat reply is instant).

const BRAND = "#3f5bd9";
const GREEN = "#16a34a";
const AMBER = "#d97706";

type DocFile = { label: string; url: string };
type Msg = { id: number; role: "qra" | "you"; text: string; tone?: "note" | "error" };

const SEV_BOX: Record<string, string> = {
  high: "border-red-200 bg-red-50",
  medium: "border-amber-200 bg-amber-50",
  low: "border-slate-200 bg-slate-50",
};
const SEV_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

function labelFor(field: string) {
  return field.replace(/_/g, " ");
}

function Bubble({ m }: { m: Msg }) {
  if (m.role === "you") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm leading-relaxed text-white"
          style={{ backgroundColor: BRAND }}
        >
          {m.text}
        </div>
      </div>
    );
  }
  const tone =
    m.tone === "error"
      ? "bg-red-50 text-red-700"
      : m.tone === "note"
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-slate-800";
  return (
    <div className="flex justify-start">
      <div className={`max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm leading-relaxed ${tone}`}>
        {m.text}
      </div>
    </div>
  );
}

function DocCards({ files, onPreview }: { files: DocFile[]; onPreview: (f: DocFile) => void }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {files.map((f) => (
        <div key={f.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-lg">📄</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">{f.label}</div>
            <div className="text-[11px] text-slate-400">PDF · ready</div>
          </div>
          <button
            onClick={() => onPreview(f)}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-[#3f5bd9] hover:bg-[#eef1fc]"
          >
            Preview
          </button>
        </div>
      ))}
    </div>
  );
}

export function ChaReviewChat({
  shipmentId,
  reference,
  status,
  files,
  reviewStatus,
  reviewNote,
}: {
  shipmentId: string;
  reference: string;
  status: string;
  files: DocFile[];
  reviewStatus: string | null;
  reviewNote: string | null;
}) {
  const router = useRouter();
  const idRef = useRef(0);

  const filed = reviewStatus === "filed";
  const approved = reviewStatus === "docs_approved";
  // The pack is actionable only while it sits on the broker's desk. After a
  // correction it's away with the exporter (or held for a re-check) and the
  // surface is read-only until it returns.
  const onDesk = status === "customer_approved" || status === "filed_with_cha";
  const awaitingReapproval = !filed && !onDesk;

  const [log, setLog] = useState<Msg[]>([
    {
      id: 0,
      role: "qra",
      text:
        files.length === 0
          ? `No documents are on ${reference} yet.`
          : onDesk
            ? `Here's the document pack for ${reference}. Tap Preview on any card to open it large. If something's off, tell me in the box below — I'll redraft it and send it back to the exporter to re-approve.`
            : `Here's the document pack for ${reference}. Tap Preview on any card to open it large.`,
    },
  ]);
  const [preview, setPreview] = useState<DocFile | null>(null);
  const [flags, setFlags] = useState<DocReviewFlag[] | null>(null);
  const [input, setInput] = useState("");
  const [checking, startCheck] = useTransition();
  const [correcting, startCorrect] = useTransition();
  const [gateBusy, startGate] = useTransition();
  const [showRequest, setShowRequest] = useState(false);
  const [requestNote, setRequestNote] = useState("");

  function say(role: Msg["role"], text: string, tone?: Msg["tone"]) {
    setLog((l) => [...l, { id: ++idRef.current, role, text, tone }]);
  }

  function runCheck() {
    if (checking) return;
    setFlags(null);
    say("you", "Run a data check across the pack.");
    startCheck(async () => {
      const r = await runDocumentReview(shipmentId);
      if (!r.ok) {
        say("qra", r.error, "error");
        return;
      }
      setFlags(r.flags);
      if (r.flags.length === 0) {
        say("qra", "✓ No data discrepancies across the set. It's still your call as the broker.");
      } else {
        say(
          "qra",
          `I found ${r.flags.length} thing${r.flags.length > 1 ? "s" : ""} worth a look — see the cards below.${onDesk ? " Tap “Apply fix”, or tell me your own correction." : ""}`
        );
      }
    });
  }

  function correct(instruction: string) {
    const msg = instruction.trim();
    if (!msg || correcting || !onDesk) return;
    say("you", msg);
    setInput("");
    startCorrect(async () => {
      const r = await chaApplyCorrection(shipmentId, msg);
      if (!r.ok) {
        say("qra", r.error, "error");
        return;
      }
      say("qra", `Updated ${labelFor(r.field)}: “${r.oldValue || "—"}” → “${r.newValue}”.`);
      if (r.note) say("qra", r.note, "note");
      setFlags(null);
      router.refresh();
    });
  }

  function approve() {
    if (gateBusy) return;
    startGate(async () => {
      const r = await chaApproveDocs(shipmentId);
      if (!r.ok) {
        say("qra", r.error, "error");
        return;
      }
      say("qra", "✓ Documents approved (G5). When you've filed & signed on ICEGATE, mark it below.");
      router.refresh();
    });
  }

  function markFiled() {
    if (gateBusy) return;
    startGate(async () => {
      const r = await chaMarkFiled(shipmentId, "");
      if (!r.ok) {
        say("qra", r.error, "error");
        return;
      }
      router.refresh();
    });
  }

  function requestChanges() {
    const note = requestNote.trim();
    if (!note || gateBusy) return;
    startGate(async () => {
      const r = await chaRequestChanges(shipmentId, note);
      if (!r.ok) {
        say("qra", r.error, "error");
        return;
      }
      setShowRequest(false);
      setRequestNote("");
      say("qra", "Sent back to the exporter with your note. You can still file once it's fixed.");
      router.refresh();
    });
  }

  return (
    <div className="relative">
      {/* Review chat: cards-in-feed + single correction box */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-semibold text-slate-700">Document review</div>
          <button
            onClick={runCheck}
            disabled={checking || files.length === 0}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#3f5bd9] hover:bg-[#eef1fc] disabled:opacity-50"
          >
            {checking ? "Checking…" : flags ? "Re-run check" : "Run Qra check"}
          </button>
        </div>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-4">
          {log.map((m, i) => (
            <div key={m.id}>
              <Bubble m={m} />
              {i === 0 && files.length > 0 && <DocCards files={files} onPreview={setPreview} />}
            </div>
          ))}

          {flags && flags.length > 0 && (
            <div className="flex flex-col gap-2">
              {flags.map((f, i) => (
                <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${SEV_BOX[f.severity] ?? SEV_BOX.medium}`}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEV_BADGE[f.severity] ?? SEV_BADGE.medium}`}
                    >
                      {f.severity}
                    </span>
                    <span className="font-semibold text-slate-800">{labelFor(f.field)}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-400">
                      {f.source === "rule" ? "rule" : "AI"}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-700">{f.issue}</div>
                  {f.suggestion && <div className="mt-0.5 text-slate-500">Suggested: {f.suggestion}</div>}
                  {f.suggestion && onDesk && (
                    <button
                      onClick={() => correct(`${labelFor(f.field)}: ${f.suggestion}`)}
                      disabled={correcting}
                      className="mt-2 rounded-md px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: BRAND }}
                    >
                      Apply fix
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {correcting && <div className="text-xs text-slate-400">Qra is redrafting…</div>}
        </div>

        {onDesk && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              correct(input);
            }}
            className="flex items-center gap-2 border-t border-slate-100 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Tell Qra what to fix — e.g. “consignee should be ACME LLC”"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#3f5bd9]"
            />
            <button
              type="submit"
              disabled={correcting || !input.trim()}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              Send
            </button>
          </form>
        )}
      </div>

      {/* Decision bar: forgiving G5 approve → G6 file & sign, or bounce to exporter */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {filed ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            ✓ Filed &amp; signed on ICEGATE{reviewNote ? ` — ${reviewNote}` : ""}.
          </div>
        ) : awaitingReapproval ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            These documents are back with the exporter to re-approve (or being re-checked). They&apos;ll return
            to your desk once that&apos;s confirmed.
          </div>
        ) : (
          <>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Your decision</div>
            {reviewStatus === "changes_requested" && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                You requested changes{reviewNote ? `: ${reviewNote}` : ""}. You can still file once it&apos;s fixed.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={approve}
                disabled={gateBusy || approved}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: approved ? GREEN : BRAND }}
              >
                {approved ? "✓ Documents approved (G5)" : gateBusy ? "Working…" : "Approve documents (G5)"}
              </button>
              <button
                onClick={markFiled}
                disabled={gateBusy}
                className="rounded-lg border-2 px-4 py-2 text-sm font-semibold disabled:opacity-60"
                style={{ borderColor: BRAND, color: BRAND }}
              >
                File &amp; signed on ICEGATE (G6)
              </button>
              <button
                onClick={() => setShowRequest((s) => !s)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Request changes
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              You file on ICEGATE with your own DSC — Qra never holds your signature.
            </p>
            {showRequest && (
              <div className="mt-3">
                <textarea
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  rows={3}
                  placeholder="What does the exporter need to change?"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#3f5bd9]"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={requestChanges}
                    disabled={gateBusy || !requestNote.trim()}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: AMBER }}
                  >
                    Send to exporter
                  </button>
                  <button
                    onClick={() => setShowRequest(false)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating preview — single render target, floats over the surface */}
      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setPreview(null)}>
          <div
            className="h-full w-full max-w-xl animate-fade-in-up bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-sm font-semibold" style={{ color: BRAND }}>
                {preview.label}
              </span>
              <div className="flex items-center gap-3">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                >
                  Open ↗
                </a>
                <button onClick={() => setPreview(null)} aria-label="Close preview" className="text-slate-400 hover:text-slate-700">
                  ✕
                </button>
              </div>
            </div>
            <object data={preview.url} type="application/pdf" className="h-[calc(100%-49px)] w-full bg-slate-100">
              <div className="p-6 text-sm text-slate-500">
                Preview isn&apos;t available in this browser —{" "}
                <a href={preview.url} target="_blank" rel="noopener noreferrer" className="underline">
                  open the document
                </a>
                .
              </div>
            </object>
          </div>
        </div>
      )}
    </div>
  );
}

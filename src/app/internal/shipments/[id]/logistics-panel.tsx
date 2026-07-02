"use client";

import { useState, useTransition } from "react";
import { draftBookingAction, sendBookingRequestAction, parseBookingReplyAction } from "./logistics-actions";
import type { ParsedBookingConfirmation } from "@/lib/ai/parse-booking-confirmation";

// Deterministic, locale-free timestamp so server and client render the same thing
// (no hydration mismatch): "2026-07-02 10:23 UTC".
function fmtSent(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

// Logistics agent — first capability: draft an inland booking request (truck /
// container / CFS / VGM). The operator reviews it, then emails it to a
// transporter. Qra books nothing.
export function LogisticsPanel({
  shipmentId,
  initial = null,
}: {
  shipmentId: string;
  initial?: {
    subject: string;
    body: string;
    sentAt?: string;
    confirmation?: ParsedBookingConfirmation;
  } | null;
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [transporter, setTransporter] = useState("");
  const [sentAt, setSentAt] = useState<string | null>(initial?.sentAt ?? null);
  const [reply, setReply] = useState("");
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ParsedBookingConfirmation | null>(initial?.confirmation ?? null);

  function run() {
    setError(null);
    setCopied(false);
    setSentAt(null);
    setReply("");
    setParseErr(null);
    setConfirmation(null);
    start(async () => {
      const r = await draftBookingAction(shipmentId);
      if (r.ok) setDraft(r.draft);
      else setError(r.error);
    });
  }

  function parseReply() {
    setParseErr(null);
    start(async () => {
      const r = await parseBookingReplyAction(shipmentId, reply);
      if (r.ok) setConfirmation(r.confirmation);
      else setParseErr(r.error);
    });
  }

  function send() {
    if (!draft) return;
    setError(null);
    start(async () => {
      const r = await sendBookingRequestAction(shipmentId, transporter, draft.subject, draft.body);
      if (r.ok) {
        setSentAt(new Date().toISOString());
        if (r.warning) setError(r.warning);
      } else setError(r.error);
    });
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Logistics agent — draft booking request</h3>
          <p className="mt-0.5 max-w-xl text-xs text-zinc-500">
            Drafts a transporter / CFS booking request (truck → port, container, CFS slot, VGM) from this
            shipment&apos;s cargo. Review, then email it. Qra books nothing.
          </p>
        </div>
        <button
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Drafting…" : "Draft booking"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      {draft && (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-zinc-700">Subject: {draft.subject}</div>
            <button onClick={copy} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-700">
            {draft.body}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3">
            <input
              type="email"
              value={transporter}
              onChange={(e) => {
                setTransporter(e.target.value);
                setSentAt(null);
              }}
              placeholder="transporter@example.com"
              className="flex-1 min-w-[180px] rounded-md border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              onClick={send}
              disabled={pending || !transporter.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send booking request"}
            </button>
            {sentAt && <span className="text-xs font-semibold text-emerald-700">Sent ✓ · {fmtSent(sentAt)}</span>}
          </div>
          <div className="mt-3 border-t border-zinc-200 pt-3">
            <div className="text-xs font-semibold text-zinc-700">Transporter&apos;s reply</div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Paste the transporter&apos;s reply; the Logistics agent reads whether they confirmed, the pickup
              date, container and cost. Advisory only — verify before you rely on it.
            </p>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Paste the transporter's reply here…"
              rows={3}
              className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={parseReply}
                disabled={pending || !reply.trim()}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {pending ? "Reading…" : "Read reply"}
              </button>
              {parseErr && <span className="text-xs text-red-600">{parseErr}</span>}
            </div>
            {confirmation && (
              <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 text-xs">
                <div className={confirmation.confirmed ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                  {confirmation.confirmed ? "Confirmed ✓" : "Not confirmed"}
                </div>
                <dl className="mt-2 space-y-1 text-zinc-700">
                  {confirmation.pickupDate && (
                    <div>
                      <span className="text-zinc-400">Pickup:</span> {confirmation.pickupDate}
                    </div>
                  )}
                  {confirmation.containerDetails && (
                    <div>
                      <span className="text-zinc-400">Container:</span> {confirmation.containerDetails}
                    </div>
                  )}
                  {confirmation.cost && (
                    <div>
                      <span className="text-zinc-400">Cost:</span> {confirmation.cost}
                    </div>
                  )}
                  {confirmation.notes && (
                    <div>
                      <span className="text-zinc-400">Notes:</span> {confirmation.notes}
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

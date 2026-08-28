"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  portalConfirmOrder,
  portalDeclineOrder,
  portalApproveDocs,
  portalCloseShipment,
  portalVerifyOrder,
  portalProvideInfo,
  portalConfirmGoodsReady,
} from "./actions";

const CLOSEABLE = ["filed_with_cha", "customs_cleared", "in_transit", "delivered"];

type Result = { ok: true } | { ok: false; error: string };
type VerifyField = { key: string; label: string; value: string; drafted: boolean };
type InfoField = {
  key: string;
  label: string;
  value: string;
  proposal?: { amount: string; note: string };
};
type Gate = {
  kind: "confirm" | "verify" | "approve" | "goods" | "close" | "info";
  title: string;
  subtitle: string;
};

function gateFor(status: string, infoHint: string | null): Gate | null {
  if (status === "awaiting_order_confirm")
    return {
      kind: "confirm",
      title: "Confirm this order?",
      subtitle: "Confirming starts your export documents. Decline if this isn't one to process.",
    };
  if (status === "awaiting_customer_verify")
    return {
      kind: "verify",
      title: "Quick check before your documents",
      subtitle: "Confirm what Qra read from your PO — or fix anything that's off, right here.",
    };
  if (status === "awaiting_customer_approval")
    return {
      kind: "approve",
      title: "Approve your documents",
      subtitle: "Review the documents below, then approve to send them to your CHA.",
    };
  if (status === "awaiting_goods_ready")
    return {
      kind: "goods",
      title: "Are your goods ready to ship?",
      subtitle:
        "Your documents are approved. Confirm your goods are ready, and we'll send the pack to your CHA for filing.",
    };
  if (status === "awaiting_customer_info" && infoHint)
    return { kind: "info", title: "A few more details needed", subtitle: infoHint };
  if (CLOSEABLE.includes(status))
    return {
      kind: "close",
      title: "Close this shipment?",
      subtitle: "Your documents are filed. Close it once complete to wrap up your records.",
    };
  return null;
}

// The exporter console's action pop-up. Every gate that needs the exporter —
// confirm the order, verify/correct the data, approve the documents, close the
// shipment, or a "more info needed" notice — opens as a pop-up on load so it's
// never missed, mirroring the same ask sent on WhatsApp. Dismissible, with a slim
// always-visible banner to reopen it.
export function GateActions({
  token,
  shipmentId,
  status,
  verifyLines = [],
  verifyFields = [],
  infoFields = [],
  infoHint = null,
  chaChangeNote = null,
}: {
  token: string;
  shipmentId: string;
  status: string;
  verifyLines?: string[];
  verifyFields?: VerifyField[];
  infoFields?: InfoField[];
  infoHint?: string | null;
  chaChangeNote?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...verifyFields.map((f) => [f.key, f.value] as const),
      // Info fields with a computed proposal start pre-filled with that amount so
      // the exporter can confirm with one tap; the rest start blank as before.
      ...infoFields.map((f) => [f.key, f.proposal?.amount ?? f.value] as const),
    ])
  );

  const gate = gateFor(status, infoHint);
  if (!gate) return null;

  // CHA bounced the docs back with a note → the approve gate reopens in the
  // "changes requested" (amber) variant so the exporter sees WHY before re-approving.
  const chaChange =
    gate.kind === "approve" && typeof chaChangeNote === "string" && chaChangeNote.trim() !== "";
  const title = chaChange ? "Your CHA requested a change" : gate.title;
  const subtitle = chaChange
    ? "We've reopened your documents — review the update below, then re-approve to send them back to your CHA."
    : gate.subtitle;

  function run(fn: () => Promise<Result>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  // Send only the fields the exporter actually changed as corrections; an
  // unchanged confirm keeps the drafted value (and its CHA-confirm marker).
  function confirmVerify() {
    const corrections: Record<string, string> = {};
    for (const f of verifyFields) {
      const v = (vals[f.key] ?? "").trim();
      if (v && v !== f.value) corrections[f.key] = v;
    }
    const has = Object.keys(corrections).length > 0;
    run(() => portalVerifyOrder(token, shipmentId, has ? corrections : undefined));
  }

  // Gap-fill gate: send the missing required values the exporter typed (blanks
  // dropped — the server re-checks completeness before advancing).
  function submitInfo() {
    const provided: Record<string, string> = {};
    for (const f of infoFields) {
      const v = (vals[f.key] ?? "").trim();
      if (v) provided[f.key] = v;
    }
    run(() => portalProvideInfo(token, shipmentId, provided));
  }

  const accentBtn = chaChange
    ? "bg-amber-600 hover:bg-amber-700"
    : {
        confirm: "bg-[#3f5bd9] hover:bg-[#3349be]",
        verify: "bg-amber-600 hover:bg-amber-700",
        approve: "bg-[#3f5bd9] hover:bg-[#3349be]",
        goods: "bg-[#3f5bd9] hover:bg-[#3349be]",
        close: "bg-[#3f5bd9] hover:bg-[#3349be]",
        info: "bg-sky-600 hover:bg-sky-700",
      }[gate.kind];
  const accentBorder = chaChange
    ? "border-amber-500"
    : {
        confirm: "border-[#3f5bd9]",
        verify: "border-amber-500",
        approve: "border-[#3f5bd9]",
        goods: "border-[#3f5bd9]",
        close: "border-[#3f5bd9]",
        info: "border-sky-500",
      }[gate.kind];

  const changed = verifyFields.some((f) => (vals[f.key] ?? "").trim() !== f.value);
  const infoFilled = infoFields.some((f) => (vals[f.key] ?? "").trim() !== "");

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={`w-full rounded-xl border-2 ${accentBorder} bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50`}
        >
          ⚠ Action needed: {title} — tap to review
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Dismiss"
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

            {chaChange && (
              <div className="mt-3 rounded-lg border border-amber-500 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="font-semibold">Their note:</div>
                <div className="mt-1 italic break-words">&ldquo;{chaChangeNote}&rdquo;</div>
              </div>
            )}

            {gate.kind === "verify" && (
              <div className="mt-3 space-y-3">
                {verifyLines.length > 0 && (
                  <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                    {verifyLines.map((l, i) => (
                      <li key={i}>{l.replace(/^•\s*/, "")}</li>
                    ))}
                  </ul>
                )}
                {verifyFields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {f.label}
                      {f.drafted ? " · Qra draft" : ""}
                    </span>
                    <input
                      value={vals[f.key] ?? ""}
                      onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            )}

            {gate.kind === "info" && infoFields.length > 0 && (
              <div className="mt-3 space-y-3">
                {infoFields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {f.label}
                    </span>
                    <input
                      value={vals[f.key] ?? ""}
                      onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                    />
                    {f.proposal && (
                      <span className="mt-1 block text-[11px] text-slate-400">
                        Qra calculated this from {f.proposal.note} — confirm or edit.
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {gate.kind === "confirm" && (
                <>
                  <button
                    disabled={pending}
                    onClick={() => run(() => portalConfirmOrder(token, shipmentId))}
                    className={`flex-1 rounded-lg ${accentBtn} px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60`}
                  >
                    {pending ? "Working…" : "Confirm order"}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => run(() => portalDeclineOrder(token, shipmentId))}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Decline
                  </button>
                </>
              )}
              {gate.kind === "verify" && (
                <button
                  disabled={pending}
                  onClick={confirmVerify}
                  className={`w-full rounded-lg ${accentBtn} px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60`}
                >
                  {pending ? "Working…" : changed ? "Save changes & confirm" : "Confirm details are correct"}
                </button>
              )}
              {gate.kind === "approve" && (
                <>
                  <button
                    disabled={pending}
                    onClick={() => run(() => portalApproveDocs(token, shipmentId))}
                    className={`flex-1 rounded-lg ${accentBtn} px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60`}
                  >
                    {pending ? "Approving…" : "Approve documents"}
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Review first
                  </button>
                </>
              )}
              {gate.kind === "goods" && (
                <>
                  <button
                    disabled={pending}
                    onClick={() => run(() => portalConfirmGoodsReady(token, shipmentId))}
                    className={`flex-1 rounded-lg ${accentBtn} px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60`}
                  >
                    {pending ? "Working…" : "Yes, ready to ship"}
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Not yet
                  </button>
                </>
              )}
              {gate.kind === "close" && (
                <button
                  disabled={pending}
                  onClick={() => run(() => portalCloseShipment(token, shipmentId))}
                  className={`w-full rounded-lg ${accentBtn} px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60`}
                >
                  {pending ? "Closing…" : "Close shipment"}
                </button>
              )}
              {gate.kind === "info" && (
                <>
                  <button
                    disabled={pending || !infoFilled}
                    onClick={submitInfo}
                    className={`flex-1 rounded-lg ${accentBtn} px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60`}
                  >
                    {pending ? "Working…" : "Submit details"}
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    or reply on WhatsApp
                  </button>
                </>
              )}
            </div>

            {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { portalGenerateDoc } from "./actions";

type Kind = "proforma_invoice" | "certificate_of_origin";

const DOCS: { kind: Kind; label: string }[] = [
  { kind: "proforma_invoice", label: "Proforma Invoice" },
  { kind: "certificate_of_origin", label: "Certificate of Origin" },
];

// Buttons for the two situational documents the exporter generates only if asked:
// a proforma invoice (a pre-order quote) and a certificate of origin (some
// destinations need it). On success the new file shows up in the Documents list
// above after the page refreshes.
export function OptionalDocs({ token, shipmentId }: { token: string; shipmentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const gen = (kind: Kind, label: string) => {
    setMsg(null);
    setBusy(kind);
    startTransition(async () => {
      const r = await portalGenerateDoc(token, shipmentId, kind);
      setBusy(null);
      if (r.ok) {
        setMsg({ ok: true, text: `${label} generated — it's in your documents above.` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error });
      }
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-sm font-semibold text-slate-700">Optional documents</div>
      <div className="mt-0.5 text-xs text-slate-500">
        Generate these only if your buyer or bank asks for them.
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {DOCS.map(({ kind, label }) => (
          <button
            key={kind}
            onClick={() => gen(kind, label)}
            disabled={pending}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-[#3f5bd9] hover:bg-[#eef1fc] disabled:opacity-50"
          >
            {busy === kind ? "Generating…" : `Generate ${label}`}
          </button>
        ))}
      </div>
      {msg && (
        <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-amber-700"}`}>{msg.text}</div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveShipmentExtraction } from "./actions";

const FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "buyer_name", label: "Buyer name", placeholder: "e.g. Müller GmbH" },
  { key: "buyer_address", label: "Buyer address", placeholder: "Street, city, postal, country" },
  { key: "destination_country", label: "Destination country", placeholder: "ISO code or name" },
  { key: "hs_code", label: "HS code", placeholder: "8-digit, e.g. 10063020" },
  { key: "product_description", label: "Product description", placeholder: "Goods being shipped" },
  { key: "quantity", label: "Quantity", placeholder: "Number" },
  { key: "quantity_unit", label: "Unit", placeholder: "kg, MT, pcs" },
  { key: "value_amount", label: "Invoice value", placeholder: "Amount" },
  { key: "value_currency", label: "Currency", placeholder: "USD, EUR, INR" },
  { key: "incoterm", label: "Incoterm", placeholder: "FOB, CIF, EXW" },
];

const STATUS_OPTIONS = [
  { value: "po_received", label: "PO received" },
  { value: "fields_extracted", label: "Fields extracted" },
  { value: "docs_generated", label: "Docs generated" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "rejected", label: "Rejected" },
];

type Props = {
  shipmentId: string;
  initialExtracted: Record<string, string>;
  initialStatus: string;
  initialNotes: string;
};

export function ExtractionForm({
  shipmentId,
  initialExtracted,
  initialStatus,
  initialNotes,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [extracted, setExtracted] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of FIELDS) init[f.key] = initialExtracted[f.key] ?? "";
    return init;
  });
  const [status, setStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(initialNotes);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveShipmentExtraction({
        shipmentId,
        extractedData: extracted,
        status,
        notes,
      });
      if (result.ok) {
        setMessage({ ok: true, text: "Saved." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Extracted fields
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-700 font-medium">{f.label}</span>
              <input
                type="text"
                value={extracted[f.key]}
                onChange={(e) =>
                  setExtracted((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                placeholder={f.placeholder}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Status
        </h2>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Notes
        </h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any observations about this shipment"
          rows={4}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
      </section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        {message && (
          <span
            className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}
          >
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

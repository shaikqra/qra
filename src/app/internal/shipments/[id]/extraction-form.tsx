"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveShipmentExtraction } from "./actions";
import { extractShipmentFields } from "./extract-action";

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
  { key: "number_of_packages", label: "No. of packages", placeholder: "e.g. 500" },
  { key: "package_type", label: "Package type", placeholder: "bags, cartons, pallets" },
  { key: "net_weight", label: "Net weight", placeholder: "Total net" },
  { key: "gross_weight", label: "Gross weight", placeholder: "Total gross" },
  { key: "weight_unit", label: "Weight unit", placeholder: "kg, MT" },
  { key: "port_of_loading", label: "Port of loading", placeholder: "e.g. Chennai" },
  { key: "port_of_discharge", label: "Port of discharge", placeholder: "e.g. Rotterdam" },
  { key: "vessel_name", label: "Vessel name", placeholder: "Vessel / voyage" },
  { key: "container_no", label: "Container no.", placeholder: "Container number" },
  { key: "seal_no", label: "Seal no.", placeholder: "Seal number" },
  { key: "batch_code", label: "Batch code", placeholder: "Batch / production code" },
  { key: "lot_code", label: "Lot code", placeholder: "Lot number" },
];

const STATUS_OPTIONS = [
  { value: "po_received", label: "PO received" },
  { value: "data_extracting", label: "Data extracting" },
  { value: "awaiting_customer_info", label: "Awaiting customer info" },
  { value: "generating_documents", label: "Generating documents" },
  { value: "sanctions_screening", label: "Sanctions screening" },
  { value: "bucket_b_review", label: "Bucket B review" },
  { value: "awaiting_customer_approval", label: "Awaiting customer approval" },
  { value: "filed_with_cha", label: "Filed with CHA" },
  { value: "customs_cleared", label: "Customs cleared" },
  { value: "in_transit", label: "In transit" },
  { value: "delivered", label: "Delivered" },
  { value: "completed", label: "Completed" },
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
  const [extractPending, startExtract] = useTransition();
  const [extractMsg, setExtractMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function handleExtract() {
    setExtractMsg(null);
    startExtract(async () => {
      const result = await extractShipmentFields(shipmentId);
      if (result.ok) {
        // Fill in what the AI found; keep any value the AI left blank.
        setExtracted((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(result.fields)) {
            if (v) next[k] = v;
          }
          return next;
        });
        setExtractMsg({ ok: true, text: "Filled from PO — review, then Save." });
      } else {
        setExtractMsg({ ok: false, text: result.error });
      }
    });
  }

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
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Extracted fields
          </h2>
          <button
            type="button"
            onClick={handleExtract}
            disabled={extractPending}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            {extractPending ? "Reading PO…" : "✨ Extract with AI"}
          </button>
          {extractMsg && (
            <span className={`text-xs ${extractMsg.ok ? "text-emerald-700" : "text-red-600"}`}>
              {extractMsg.text}
            </span>
          )}
        </div>
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

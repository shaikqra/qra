"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateCommercialInvoice } from "./generate-invoice";
import { generatePackingList } from "./generate-packing-list";
import { generateCertificateOfOrigin } from "./generate-coo";
import { generateProformaInvoice } from "./generate-proforma";
import { generateShippingBillPack } from "./generate-sbpack";
import { approveAndSendDocs } from "./send-docs";
import { sendDocsToCha } from "./send-to-cha";

type GeneratedDoc = {
  id: string;
  doc_type: string;
  output_sha256: string;
  generated_at: string;
  url: string | null;
};

const DOC_LABELS: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  certificate_of_origin: "Certificate of Origin",
  proforma_invoice: "Proforma Invoice",
  shipping_bill_pack: "Shipping Bill Data Sheet (for CHA)",
};

export function InvoicePanel({
  shipmentId,
  docs,
}: {
  shipmentId: string;
  docs: GeneratedDoc[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  type GenResult = { ok: true; downloadUrl: string } | { ok: false; error: string };

  function handleGenerate(
    label: string,
    action: (id: string) => Promise<GenResult>
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await action(shipmentId);
      if (result.ok) {
        setMessage({ ok: true, text: `${label} generated.` });
        if (result.downloadUrl) window.open(result.downloadUrl, "_blank");
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => handleGenerate("Commercial invoice", generateCommercialInvoice)}
          disabled={pending}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate Commercial Invoice"}
        </button>
        <button
          type="button"
          onClick={() => handleGenerate("Packing list", generatePackingList)}
          disabled={pending}
          className="rounded-md border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate Packing List"}
        </button>
        <button
          type="button"
          onClick={() => handleGenerate("Certificate of origin", generateCertificateOfOrigin)}
          disabled={pending}
          className="rounded-md border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate Certificate of Origin"}
        </button>
        <button
          type="button"
          onClick={() => handleGenerate("Proforma invoice", generateProformaInvoice)}
          disabled={pending}
          className="rounded-md border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate Proforma Invoice"}
        </button>
        <button
          type="button"
          onClick={() => handleGenerate("Shipping bill data sheet", generateShippingBillPack)}
          disabled={pending}
          className="rounded-md border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate Shipping Bill Sheet"}
        </button>
        {docs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                const result = await approveAndSendDocs(shipmentId);
                if (result.ok) {
                  setMessage({
                    ok: true,
                    text: `Approved — ${result.sent} document(s) sent to the customer on WhatsApp.`,
                  });
                  router.refresh();
                } else {
                  setMessage({ ok: false, text: result.error });
                }
              });
            }}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Working…" : "✅ Approve & send to customer"}
          </button>
        )}
        {docs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                const result = await sendDocsToCha(shipmentId);
                if (result.ok) {
                  setMessage({
                    ok: true,
                    text: `Emailed ${result.sent} document(s) to the CHA — status set to filed with CHA.`,
                  });
                  router.refresh();
                } else {
                  setMessage({ ok: false, text: result.error });
                }
              });
            }}
            disabled={pending}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Working…" : "📧 Email to CHA"}
          </button>
        )}
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
      </div>

      {docs.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          No documents generated yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 bg-white p-3 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-medium text-zinc-800">
                  {DOC_LABELS[doc.doc_type] ?? doc.doc_type}
                </span>
                <span className="text-xs text-zinc-500">
                  {new Date(doc.generated_at).toLocaleString()} · sha256{" "}
                  <span className="font-mono">{doc.output_sha256.slice(0, 10)}…</span>
                </span>
              </div>
              {doc.url ? (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Download ↓
                </a>
              ) : (
                <span className="text-xs text-zinc-400">link expired — refresh</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

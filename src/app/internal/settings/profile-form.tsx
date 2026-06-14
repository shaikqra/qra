"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveExporterProfile, type ExporterProfileInput } from "./actions";
import type { ChaContactInput } from "@/lib/profile-fields";
import { ChaListEditor, emptyCha } from "@/components/cha-list-editor";

type Field = { key: keyof ExporterProfileInput; label: string; placeholder?: string; area?: boolean };

const IDENTITY: Field[] = [
  { key: "legal_name", label: "Legal name", placeholder: "Nava Quality Foods Pvt Ltd" },
  { key: "address", label: "Registered address", placeholder: "Full address", area: true },
  { key: "factory_address", label: "Factory address", placeholder: "Factory / plant address", area: true },
  { key: "iec", label: "IEC (Import Export Code)", placeholder: "10 digits" },
  { key: "gstin", label: "GSTIN", placeholder: "15 characters" },
  { key: "cin", label: "CIN", placeholder: "Company ID number" },
  { key: "organic_code", label: "Organic code", placeholder: "e.g. IN-BIO-132" },
  { key: "default_currency", label: "Default currency", placeholder: "USD" },
  { key: "default_incoterm", label: "Default incoterm", placeholder: "FOB" },
];

const BANK: Field[] = [
  { key: "bank_name", label: "Bank name", placeholder: "HDFC Bank, branch" },
  { key: "bank_branch", label: "Branch", placeholder: "Branch / city" },
  { key: "bank_swift", label: "SWIFT code", placeholder: "e.g. HDFCINBB" },
  { key: "bank_account", label: "Account / IBAN", placeholder: "Account number" },
  { key: "bank_beneficiary", label: "Beneficiary name", placeholder: "Account holder name" },
];

const DECLARATIONS: Field[] = [
  {
    key: "declaration_lut",
    label: "LUT declaration (export without IGST)",
    placeholder: "Paste your exact LUT wording incl. ARN and date",
    area: true,
  },
  {
    key: "declaration_rodtep",
    label: "RoDTEP declaration",
    placeholder: "RoDTEP claim wording",
    area: true,
  },
  {
    key: "declaration_origin",
    label: "Statement on Origin (EU GSP / REX)",
    placeholder: "Statement of origin incl. your REX number",
    area: true,
  },
];

// Generic templates with placeholders — fill in your real numbers.
const DEFAULTS: Partial<Record<keyof ExporterProfileInput, string>> = {
  declaration_lut:
    'As per Rule 96A of the CGST Rules, 2017, "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX", VIDE LUT NO: [your LUT ARN] dated [date].',
  declaration_rodtep:
    "EXPORT UNDER (RoDTEP): WE INTEND TO CLAIM REWARDS UNDER THE REMISSION OF DUTIES AND TAXES ON EXPORTED PRODUCTS (RoDTEP).",
  declaration_origin:
    'The Exporter [legal name], registered under number [your REX number], declares that, except where otherwise clearly indicated, these products are of INDIAN preferential origin according to the rules of origin of the Generalised System of Preferences of the European Union, and that the origin criterion met is "P".',
};

export function ProfileForm({
  initial,
  customerId,
  initialCustomerName,
  initialChas,
}: {
  initial: Partial<ExporterProfileInput> | null;
  customerId: string | null;
  initialCustomerName?: string;
  initialChas?: ChaContactInput[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [customerName, setCustomerName] = useState(initialCustomerName ?? "");

  const allFields = [...IDENTITY, ...BANK, ...DECLARATIONS];
  const [values, setValues] = useState<ExporterProfileInput>(() => {
    const v = {} as ExporterProfileInput;
    for (const f of allFields) v[f.key] = initial?.[f.key] ?? DEFAULTS[f.key] ?? "";
    return v;
  });

  const [chas, setChas] = useState<ChaContactInput[]>(
    initialChas && initialChas.length > 0 ? initialChas : [emptyCha(true)]
  );

  function set(key: keyof ExporterProfileInput, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveExporterProfile(values, customerId, customerName, chas);
      if (result.ok) {
        setMessage({ ok: true, text: "Saved." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  const renderField = (f: Field) => (
    <label key={f.key} className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-700 font-medium">{f.label}</span>
      {f.area ? (
        <textarea
          value={values[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
          placeholder={f.placeholder}
          rows={3}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
      ) : (
        <input
          type="text"
          value={values[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
          placeholder={f.placeholder}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
      )}
    </label>
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8 max-w-3xl">
      {customerId && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
            Customer
          </h2>
          <label className="flex flex-col gap-1 text-sm max-w-sm">
            <span className="text-zinc-700 font-medium">Customer name</span>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Nava Quality Foods"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </label>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Identity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{IDENTITY.map(renderField)}</div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">Bank details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{BANK.map(renderField)}</div>
      </section>

      {customerId && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
            Customs broker(s) — CHA
          </h2>
          <p className="text-xs text-zinc-500 mb-3 -mt-2">
            Add more than one if this exporter uses a different broker per port. The default broker
            receives the documents automatically.
          </p>
          <ChaListEditor value={chas} onChange={setChas} accent="zinc" />
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Standard declarations
        </h2>
        <div className="flex flex-col gap-3">{DECLARATIONS.map(renderField)}</div>
      </section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

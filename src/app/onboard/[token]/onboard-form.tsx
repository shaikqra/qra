"use client";

import { useState, useTransition } from "react";
import {
  IDENTITY_FIELDS,
  BANK_FIELDS,
  DECLARATION_FIELDS,
  ALL_PROFILE_FIELDS,
  type ExporterProfileInput,
  type ChaContactInput,
  type ProfileField,
} from "@/lib/profile-fields";
import { ChaListEditor, emptyCha } from "@/components/cha-list-editor";
import { submitOnboarding } from "./actions";

export function OnboardForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [values, setValues] = useState<ExporterProfileInput>(() => {
    const v = {} as ExporterProfileInput;
    for (const f of ALL_PROFILE_FIELDS) v[f.key] = "";
    return v;
  });

  const [chas, setChas] = useState<ChaContactInput[]>([emptyCha(true)]);

  function set(key: keyof ExporterProfileInput, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  const renderField = (f: ProfileField) => (
    <label key={f.key} className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-700 font-medium">{f.label}</span>
      {f.area ? (
        <textarea
          value={values[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
          placeholder={f.placeholder}
          rows={3}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      ) : (
        <input
          type="text"
          value={values[f.key]}
          onChange={(e) => set(f.key, e.target.value)}
          placeholder={f.placeholder}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      )}
    </label>
  );

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="text-3xl mb-2">✅</div>
        <h2 className="text-xl font-semibold text-emerald-900">All set — thank you!</h2>
        <p className="mt-2 text-sm text-emerald-800">
          Your company details are saved. From your next purchase order onward, your export
          documents will carry them automatically. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!values.legal_name.trim()) {
          setError("Please fill in at least your company's legal name.");
          return;
        }
        startTransition(async () => {
          const r = await submitOnboarding(token, values, chas);
          if (r.ok) setDone(true);
          else setError(r.error);
        });
      }}
      className="flex flex-col gap-8"
    >
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Company identity
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {IDENTITY_FIELDS.map(renderField)}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Bank details <span className="normal-case font-normal text-zinc-400">(printed on your invoices)</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{BANK_FIELDS.map(renderField)}</div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Your customs broker(s) — CHA
        </h2>
        <p className="text-xs text-zinc-500 mb-3 -mt-2">
          Add more than one if you use a different broker at different ports. The default broker
          receives your export documents automatically.
        </p>
        <ChaListEditor value={chas} onChange={setChas} accent="emerald" />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          Standard declarations <span className="normal-case font-normal text-zinc-400">(skip what you don&apos;t use)</span>
        </h2>
        <div className="flex flex-col gap-3">{DECLARATION_FIELDS.map(renderField)}</div>
      </section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save my details"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}

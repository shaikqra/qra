import type { ProvenanceRow, FieldSource } from "@/lib/provenance/fields";

const SRC: Record<FieldSource, { label: string; cls: string }> = {
  profile: { label: "Your profile", cls: "bg-slate-100 text-slate-600" },
  po: { label: "From your PO", cls: "bg-sky-50 text-sky-700" },
  draft: { label: "Qra draft — confirm", cls: "bg-amber-50 text-amber-700" },
  default: { label: "Your default", cls: "bg-slate-100 text-slate-600" },
};

// Per-field provenance in the exporter console: every value on the documents +
// where it came from. Qra invents nothing — each value traces to a source.
export function ProvenancePanel({ rows }: { rows: ProvenanceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Where your data came from</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs text-slate-500">
          Every value on your documents traces to a source — Qra invents nothing.
        </p>
        <div className="flex flex-col divide-y divide-slate-100">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {r.label}
              </div>
              <div className="min-w-0 flex-1 truncate text-sm text-slate-800">{r.value}</div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${SRC[r.source].cls}`}>
                {SRC[r.source].label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

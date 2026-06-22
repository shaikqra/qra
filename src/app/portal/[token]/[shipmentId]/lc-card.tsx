export type LcReviewItem = {
  field: string;
  severity: "high" | "medium" | "low";
  lcRequires: string;
  documentsShow: string;
  suggestion: string;
};

const SEV: Record<string, string> = {
  high: "border-red-200 bg-red-50",
  medium: "border-amber-200 bg-amber-50",
  low: "border-slate-200 bg-slate-50",
};
const SEV_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

// The Treasury agent's Letter-of-Credit check in the exporter console: where the
// shipment's documents would FAIL the LC (UCP 600), so a clean presentation
// releases payment. Advisory — the bank is the final authority.
export function LcCard({ lc }: { lc: { count: number; discrepancies: LcReviewItem[] } | null }) {
  if (!lc) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Letter of credit check</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {lc.count === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            ✓ Your documents comply with the LC — no discrepancies found.
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              Where your documents would fail the LC — fix these before presenting to the bank, or it can refuse
              payment. Advisory; your bank is the final word.
            </p>
            <ul className="flex flex-col gap-2">
              {lc.discrepancies.map((x, i) => (
                <li key={i} className={`rounded-lg border px-3 py-2 text-sm ${SEV[x.severity] ?? SEV.medium}`}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEV_BADGE[x.severity] ?? SEV_BADGE.medium}`}
                    >
                      {x.severity}
                    </span>
                    <span className="font-semibold text-slate-800">{x.field}</span>
                  </div>
                  {(x.lcRequires || x.documentsShow) && (
                    <div className="mt-1 text-xs text-slate-600">
                      <span className="text-slate-400">LC requires:</span> {x.lcRequires || "—"} ·{" "}
                      <span className="text-slate-400">your docs show:</span> {x.documentsShow || "—"}
                    </div>
                  )}
                  {x.suggestion && <div className="mt-0.5 text-xs text-slate-500">Fix: {x.suggestion}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

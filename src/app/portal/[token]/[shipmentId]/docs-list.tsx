export type DocItem = { name: string; note: string; issuedBy: string };

// The Required-Documents agent's output in the exporter console — the extra
// documents this lane needs BEYOND Qra's standard set. When it came from a VERIFIED
// Trade Graph rule (human-checked + cited) it's framed as more trustworthy but still
// CHA/buyer-confirmed; an AI DRAFT is framed as a prompt to check, never a complete
// checklist (a missed document is the dangerous failure). Qra issues/files none.
export function DocsList({
  items,
  source,
  citation,
}: {
  items: DocItem[];
  source: string;
  citation: string;
}) {
  if (items.length === 0) return null;
  const verified = source === "verified";
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Documents to check for
      </h2>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {verified && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            ✓ Analyst-verified{citation ? ` · ${citation}` : ""}
          </div>
        )}
        <p className="mb-3 text-xs text-slate-500">
          {verified ? (
            <>
              Extra documents beyond your standard set (invoice, packing list, CoO, export declaration), from Qra&apos;s
              verified Trade Graph rule for your goods + destination. Still confirm the full set with your CHA / buyer
              before you ship — Qra issues and files no documents.
            </>
          ) : (
            <>
              Extra documents beyond your standard set (invoice, packing list, CoO, export declaration) — a
              starting-point list, <span className="font-semibold">not a complete or final checklist.</span> Treat each
              as &ldquo;check this,&rdquo; and confirm the full set (including anything not shown) with your CHA / buyer
              before you ship. Qra doesn&apos;t issue, file, or guarantee any document, and a required one may be missing
              from this list.
            </>
          )}
        </p>
        <ul className="flex flex-col gap-2.5">
          {items.map((c, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{c.name}</div>
                {c.note && <div className="text-xs text-slate-500">{c.note}</div>}
                {c.issuedBy && <div className="mt-0.5 text-[11px] text-slate-400">Issued by: {c.issuedBy}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export type CertItem = { name: string; note: string; issuedBy: string };

// The Certification agent's output in the exporter console. When it came from a
// VERIFIED Trade Graph rule (human-checked + cited) it's framed as more trustworthy
// but still CHA-confirmed; an AI DRAFT is framed as a prompt to check, never a
// complete checklist (a missed cert is the dangerous failure). Qra issues none.
export function CertList({
  items,
  source,
  citation,
}: {
  items: CertItem[];
  source: string;
  citation: string;
}) {
  if (items.length === 0) return null;
  const verified = source === "verified";
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Certificates to check for
      </h2>
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        {verified && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            ✓ Verified rule for this lane{citation ? ` · ${citation}` : ""}
          </div>
        )}
        <p className="mb-3 text-xs text-zinc-500">
          {verified ? (
            <>
              From Qra&apos;s verified Trade Graph rule for your goods + destination. Still confirm the full set with
              your CHA before you ship — Qra issues and verifies no certificates.
            </>
          ) : (
            <>
              A starting-point list for your goods + destination — <span className="font-semibold">not a complete or
              final checklist.</span> Treat each as &ldquo;check this,&rdquo; and confirm the full set (including
              anything not shown) with your CHA before you ship. Qra doesn&apos;t issue, verify, or guarantee any
              certificate, and a required document may be missing from this list.
            </>
          )}
        </p>
        <ul className="flex flex-col gap-2.5">
          {items.map((c, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-800">{c.name}</div>
                {c.note && <div className="text-xs text-zinc-500">{c.note}</div>}
                {c.issuedBy && <div className="mt-0.5 text-[11px] text-zinc-400">Issued by: {c.issuedBy}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

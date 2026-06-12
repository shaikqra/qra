// Shared helpers for parsing denied-party list files (UN, EU, ...).

export type ListEntry = { entryType: "individual" | "entity"; fullName: string };

export function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeName(s: string): string {
  return decodeXml(s)
    // Fold accents to ASCII so an accented listed name still matches the
    // plain-ASCII spelling an exporter types on a PO.
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Dedupe, drop too-short names, and enforce a sanity floor so a truncated or
// broken parse refuses to load a half-list (which would screen parties "clear"
// against incomplete data). Throws below minCount.
export function finalizeEntries(
  entries: ListEntry[],
  minCount: number,
  label: string
): ListEntry[] {
  const seen = new Set<string>();
  const out: ListEntry[] = [];
  for (const e of entries) {
    const norm = normalizeName(e.fullName);
    if (norm.length < 4) continue;
    const key = `${e.entryType}|${norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  if (out.length < minCount) {
    throw new Error(`${label} parse returned only ${out.length} entries — refusing`);
  }
  return out;
}

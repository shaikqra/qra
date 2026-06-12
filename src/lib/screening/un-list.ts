// Fetch and parse the UN Security Council Consolidated Sanctions List.
// Free public government data. We parse the fixed schema with targeted regex
// (block-split per record, then field-extract) rather than a full XML library —
// for sanctions, over-harvesting a name is safe (more review), missing one is
// not, so we collect every name + alias per record.

const UN_LIST_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

export type ListEntry = { entryType: "individual" | "entity"; fullName: string };

function decodeXml(s: string): string {
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
    // Fold accents to ASCII first so an accented listed name still matches the
    // plain-ASCII spelling an exporter types on a PO.
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeXml(m[1].trim()) : "";
}

function allAliasNames(block: string): string[] {
  const out: string[] = [];
  const re = /<ALIAS_NAME>([\s\S]*?)<\/ALIAS_NAME>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = decodeXml(m[1].trim());
    if (v) out.push(v);
  }
  return out;
}

function parseBlocks(xml: string, blockTag: string, entryType: ListEntry["entryType"]): ListEntry[] {
  const entries: ListEntry[] = [];
  // Tolerate optional attributes on the block tag (e.g. <INDIVIDUAL DELISTED="...">)
  // so a UN schema tweak can't silently make us match zero records.
  const re = new RegExp(`<${blockTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${blockTag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const parts = [
      tagText(block, "FIRST_NAME"),
      tagText(block, "SECOND_NAME"),
      tagText(block, "THIRD_NAME"),
      tagText(block, "FOURTH_NAME"),
    ].filter(Boolean);
    const primary = parts.join(" ").trim();
    if (primary) entries.push({ entryType, fullName: primary });
    for (const alias of allAliasNames(block)) {
      entries.push({ entryType, fullName: alias });
    }
  }
  return entries;
}

// Fetch the current UN list and return every individual + entity name and alias.
export async function fetchUnList(): Promise<ListEntry[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let xml: string;
  try {
    const res = await fetch(UN_LIST_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`UN list HTTP ${res.status}`);
    xml = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const entries = [
    ...parseBlocks(xml, "INDIVIDUAL", "individual"),
    ...parseBlocks(xml, "ENTITY", "entity"),
  ];

  // Drop names too short to match meaningfully (avoids junk).
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
  // Sanity floor: the real UN list is well over a thousand names. A result far
  // below that means a truncated/error fetch or a broken parse — refuse it so a
  // partial list never loads and screens parties "clear" against a half-list.
  if (out.length < 600) {
    throw new Error(`UN list parse returned only ${out.length} entries — refusing`);
  }
  return out;
}

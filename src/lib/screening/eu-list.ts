// Fetch and parse the EU Consolidated Financial Sanctions List (FSF).
// Free public EU data, served via a stable public token. Larger than the UN
// list, and structured differently: names live in attributes of <nameAlias>
// elements inside each <sanctionEntity>. We harvest every alias name per entity.

import { type ListEntry, decodeXml, finalizeEntries } from "./list-utils";

// Public token the EU FSF uses for the open consolidated list.
const EU_LIST_URL =
  "https://webgate.ec.europa.eu/europeaid/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";

function attr(tag: string, name: string): string {
  // Accept both double- and single-quoted attribute values so a quote-style
  // change in the EU file can't silently drop names.
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  if (!m) return "";
  return decodeXml((m[1] ?? m[2] ?? "").trim());
}

function parseEuEntities(xml: string): ListEntry[] {
  const entries: ListEntry[] = [];
  const blockRe = /<sanctionEntity\b[^>]*>([\s\S]*?)<\/sanctionEntity>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1];
    const subj = block.match(/<subjectType\b[^>]*\bcode="([^"]*)"/i);
    const code = (subj ? subj[1] : "").toLowerCase();
    const entryType: ListEntry["entryType"] = code === "person" ? "individual" : "entity";

    // Every <nameAlias ...> tag (self-closing or not). Names are in attributes.
    const aliasRe = /<nameAlias\b([^>]*?)\/?>/gi;
    let a: RegExpExecArray | null;
    while ((a = aliasRe.exec(block)) !== null) {
      const tag = a[1];
      let name = attr(tag, "wholeName");
      if (!name) {
        name = [attr(tag, "firstName"), attr(tag, "middleName"), attr(tag, "lastName")]
          .filter(Boolean)
          .join(" ");
      }
      if (name) entries.push({ entryType, fullName: name });
    }
  }
  return entries;
}

// Fetch the current EU list and return every entity/person name and alias.
export async function fetchEuList(): Promise<ListEntry[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let xml: string;
  try {
    const res = await fetch(EU_LIST_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`EU list HTTP ${res.status}`);
    xml = await res.text();
  } finally {
    clearTimeout(timer);
  }

  // EU list is thousands of names; a high floor stops a structurally-broken
  // parse from loading a near-empty list and clearing sanctioned buyers.
  return finalizeEntries(parseEuEntities(xml), 3000, "EU list");
}

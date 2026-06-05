// The standard PDF fonts only speak WinAnsi (Latin-1 / CP1252). Real PO data is
// full of Unicode they can't render — smart quotes, dashes, box-drawing chars
// from copied tables — so map the common ones to plain equivalents and drop the
// rest. Latin-1 accents (ü, é, ñ…) are kept, which covers the EU/CBAM wedge.
// Shared by every PDF builder so the mapping lives in exactly one place.

const PUNCT_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", // ‘ ’ ‚ ‛
  "“": '"', "”": '"', "„": '"',                 // “ ” „
  "–": "-", "—": "-", "−": "-",                 // – — −
  "‐": "-", "‑": "-",                               // ‐ ‑
  "…": "...",                                            // …
  "•": "-", "·": "-",                               // • ·
  "│": "|", "─": "-", "┃": "|",                 // │ ─ ┃
};

export function toWinAnsi(s: string): string {
  if (!s) return "";
  let out = "";
  for (const ch of s) {
    if (PUNCT_MAP[ch]) {
      out += PUNCT_MAP[ch];
      continue;
    }
    // Any whitespace (incl. nbsp, thin space, etc.) collapses to a plain space.
    if (/\s/.test(ch)) {
      out += " ";
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) out += ch;        // printable ASCII
    else if (code >= 0xa0 && code <= 0xff) out += ch;   // Latin-1 (accents)
    // anything else the font can't render is dropped
  }
  return out;
}

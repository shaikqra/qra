// Destination helpers for document generation. The EU GSP/REX "Statement on
// Origin" is an EU-specific self-certification — it must only print on shipments
// bound for the EU, never on (say) a USA invoice. This decides that.

// EU-27 member states, matched case-insensitively against common names, a few
// aliases, and 2-letter ISO codes. "European Union"/"EU" included as a catch-all.
const EU_NAMES = new Set([
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic", "czechia",
  "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "ireland",
  "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "the netherlands",
  "poland", "portugal", "romania", "slovakia", "slovenia", "spain", "sweden",
  "european union", "eu",
]);

const EU_CODES = new Set([
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "el", "hu",
  "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se", "eu",
]);

// True when the shipment's destination is an EU member state. Destinations are
// AI-extracted free text ("Hamburg, Germany", "Netherlands (NL)"), so a country
// NAME is matched as a whole word anywhere in the string; a 2-letter ISO CODE is
// matched only when it's the entire value (so a stray "it"/"es"/"eu" fragment in
// a longer string can't false-positive). Blank/unknown → false, so an EU-only
// declaration is omitted when we're unsure — never wrongly asserted.
export function isEuDestination(destination: string): boolean {
  const raw = (destination || "").trim().toLowerCase();
  if (!raw) return false;

  // Whole value is a 2-letter code (e.g. "DE", "EL").
  const codeOnly = raw.replace(/[^a-z]/g, "");
  if (codeOnly.length <= 3 && EU_CODES.has(codeOnly)) return true;

  // A country name appearing as a whole word (punctuation treated as spaces).
  const norm = ` ${raw.replace(/[^a-z]+/g, " ").trim()} `;
  for (const name of EU_NAMES) {
    if (name.length > 2 && norm.includes(` ${name} `)) return true;
  }
  return false;
}

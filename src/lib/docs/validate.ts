// Deterministic validation of extracted shipment data — the "rules dispose"
// half of the core pattern. Plain code, no AI: these checks can veto what the
// model extracted and route the shipment to the operator instead.

import type { PoConfidence } from "@/lib/ai/extract-po";

export type ValidationIssue = { field: string; reason: string };

const INCOTERMS = new Set([
  "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP",
]);

// Below these, an extracted value is not trusted without a human look.
// Critical fields are the ones that turn into money or customs data.
const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  quantity: 0.9,
  value_amount: 0.9,
  value_currency: 0.9,
  incoterm: 0.9,
  net_weight: 0.9,
  gross_weight: 0.9,
  buyer_name: 0.85,
};
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

function num(v: string): number | null {
  let cleaned = v.replace(/\s+/g, "");
  // Accept unambiguous comma thousands-grouping ("53,352" / "1,635.00") by
  // stripping the commas; anything else non-numeric still fails and flags.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) cleaned = cleaned.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Validate the merged extracted data. Only checks fields that are present —
// missing required fields are the gap-fill flow's job, not validation's.
export function validateExtracted(d: Record<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const get = (k: string) => (d[k] ?? "").trim();

  const numericFields: [string, string][] = [
    ["quantity", "Quantity"],
    ["value_amount", "Invoice value"],
    ["net_weight", "Net weight"],
    ["gross_weight", "Gross weight"],
    ["number_of_packages", "Number of packages"],
  ];
  for (const [key, label] of numericFields) {
    const v = get(key);
    if (!v) continue;
    const n = num(v);
    if (n === null) {
      issues.push({ field: key, reason: `${label} is not a plain number` });
    } else if (n <= 0) {
      issues.push({ field: key, reason: `${label} must be greater than zero` });
    }
  }

  const net = num(get("net_weight"));
  const gross = num(get("gross_weight"));
  if (net !== null && gross !== null && gross < net) {
    issues.push({ field: "gross_weight", reason: "Gross weight is less than net weight" });
  }

  const currency = get("value_currency");
  if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
    issues.push({ field: "value_currency", reason: "Currency is not a 3-letter code" });
  }

  // Incoterms are usually written with a place ("CIF Rotterdam") — validate
  // the code itself, the first word only.
  const incoterm = get("incoterm");
  const incotermCode = incoterm.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (incoterm && !INCOTERMS.has(incotermCode)) {
    issues.push({ field: "incoterm", reason: `Incoterm "${incoterm}" is not a recognised term` });
  }

  const hs = get("hs_code");
  if (hs && !/^\d{4,10}$/.test(hs.replace(/[.\s]/g, ""))) {
    issues.push({ field: "hs_code", reason: "HS code should be 4-10 digits" });
  }

  return issues;
}

// Fields whose extraction confidence is below threshold — they may be right,
// but the agent is not allowed to act on them without a human look.
export function lowConfidenceFields(
  d: Record<string, string>,
  confidence: Partial<PoConfidence>
): string[] {
  const flagged: string[] = [];
  for (const [key, c] of Object.entries(confidence)) {
    const value = (d[key] ?? "").trim();
    if (!value) continue; // blank fields are gap-fill's job
    const threshold = CONFIDENCE_THRESHOLDS[key] ?? DEFAULT_CONFIDENCE_THRESHOLD;
    if (typeof c === "number" && c < threshold) flagged.push(key);
  }
  return flagged;
}

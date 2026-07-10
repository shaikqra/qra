// Deterministic validation of extracted shipment data — the "rules dispose"
// half of the core pattern. Plain code, no AI: these checks can veto what the
// model extracted and route the shipment to the operator instead.

import type { PoConfidence } from "@/lib/ai/extract-po";
import { computeProposedValue } from "./compute-value";

export type ValidationIssue = { field: string; reason: string };

const INCOTERMS = new Set([
  "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP",
]);

// Incoterms where the invoice value should equal the goods value (quantity ×
// unit price). Under CIF/CFR/CIP/DAP/DPU/DDP the value legitimately bundles
// freight + insurance, so a value ≠ quantity × price is BY DESIGN, not an error —
// reconciliation only runs for these four (and never when the term is absent or
// unrecognised, since we don't guess).
const GOODS_VALUE_INCOTERMS = new Set(["EXW", "FCA", "FAS", "FOB"]);

// The money / quantity / weight fields the verify gate can flag as ambiguous or
// mismatched. When the exporter passes the gate we snapshot their values here
// (verifyConfirmedSnapshot); on the resume, a field whose value still matches the
// snapshot is exempt from the ambiguity + reconciliation flags — they vouched for
// it as-is — while a CHANGED value (≠ snapshot) re-validates. Stored under the
// reserved key "_verify_confirmed", like _confidence / _drafted / _needed.
// quantity_unit is included (though not numeric) so an exporter can CONFIRM a
// legitimate-but-uncommon unit past the known-unit check in one pass, instead of
// looping the gate — the same escape valve the numeric confirm cases use.
const CONFIRMABLE_NUMERIC = ["quantity", "value_amount", "unit_price", "net_weight", "gross_weight", "quantity_unit"] as const;

function readVerifyConfirmed(d: Record<string, string>): Record<string, string> {
  try {
    const v = JSON.parse(d["_verify_confirmed"] ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// The JSON snapshot the verify gate persists when the exporter confirms: the
// values they were SHOWN for the confirmable numeric fields. Written from the
// pre-correction data so a field they CHANGE isn't wrongly exempted.
export function verifyConfirmedSnapshot(d: Record<string, string>): string {
  const snap: Record<string, string> = {};
  for (const k of CONFIRMABLE_NUMERIC) {
    const v = (d[k] ?? "").trim();
    if (v) snap[k] = v;
  }
  return JSON.stringify(snap);
}

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
  // HS drives duty + RoDTEP + customs classification, so a misread must be
  // verified — held to the same elevated bar as the money/quantity fields.
  hs_code: 0.9,
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

// A value like "25.155" — one dot with EXACTLY three trailing digits — is
// genuinely ambiguous: it could be the decimal 25.155 or European thousands
// grouping for 25,155 (a 1000x difference). We never guess which; we flag it so
// the exporter confirms. Deliberately narrow: "25155", "1,635.00" (comma
// grouping), "1.5", "12.50" and "1234.5" are all unambiguous and must NOT match.
function isAmbiguousThousands(v: string): boolean {
  return /^\d+\.\d{3}$/.test(v.trim());
}

// Validate the merged extracted data. Only checks fields that are present —
// missing required fields are the gap-fill flow's job, not validation's.
export function validateExtracted(d: Record<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const get = (k: string) => (d[k] ?? "").trim();
  // Values the exporter already vouched for at the verify gate (see snapshot above).
  const confirmed = readVerifyConfirmed(d);

  // Ambiguous European thousands ("25.155" = 25.155 or 25,155?) on the money /
  // quantity / weight fields — a confirm case, not a malformed one. Flag it and
  // record the field so the plain-number checks below don't double-flag it. A
  // package COUNT is a plain integer, so it's deliberately not in this list.
  const ambiguousFields: [string, string][] = [
    ["quantity", "Quantity"],
    ["value_amount", "Invoice value"],
    ["unit_price", "Unit price"],
    ["net_weight", "Net weight"],
    ["gross_weight", "Gross weight"],
  ];
  const ambiguous = new Set<string>();
  for (const [key, label] of ambiguousFields) {
    const v = get(key);
    if (!v || !isAmbiguousThousands(v)) continue;
    // Exempt a value the exporter confirmed as-is at the gate (unchanged since) —
    // otherwise a genuine decimal like "25.155 MT" would re-flag and loop forever.
    if (confirmed[key] === v) continue;
    ambiguous.add(key);
    issues.push({
      field: key,
      reason: `${label} "${v}" is ambiguous — reply ${v.replace(".", "")} if it's a whole number, or ${v} if it's a decimal`,
    });
  }

  const numericFields: [string, string][] = [
    ["quantity", "Quantity"],
    ["value_amount", "Invoice value"],
    ["net_weight", "Net weight"],
    ["gross_weight", "Gross weight"],
    ["number_of_packages", "Number of packages"],
  ];
  for (const [key, label] of numericFields) {
    if (ambiguous.has(key)) continue; // already flagged as a confirm case
    const v = get(key);
    if (!v) continue;
    const n = num(v);
    if (n === null) {
      issues.push({ field: key, reason: `${label} is not a plain number` });
    } else if (n <= 0) {
      issues.push({ field: key, reason: `${label} must be greater than zero` });
    }
  }

  // Only compare weights we can trust — an ambiguous value isn't a real magnitude.
  const net = num(get("net_weight"));
  const gross = num(get("gross_weight"));
  if (
    !ambiguous.has("net_weight") &&
    !ambiguous.has("gross_weight") &&
    net !== null &&
    gross !== null &&
    gross < net
  ) {
    issues.push({ field: "gross_weight", reason: "Gross weight is less than net weight" });
  }

  // Reconciliation: when we can recompute the invoice value cleanly from
  // quantity × unit price (the SAME safe arithmetic the value proposer uses —
  // it returns null on any ambiguity), a stated value more than 2% off is likely
  // a typo or a misread. Flag it for the exporter to confirm — never auto-correct.
  // Only runs on goods-value incoterms (EXW/FCA/FAS/FOB): on CIF/CFR/etc. the
  // value legitimately includes freight + insurance, so value ≠ qty × price is
  // expected and must NOT flag. Parse the code like the incoterm check below
  // (first whitespace token, uppercased).
  const stated = get("value_amount");
  const reconCode = get("incoterm").split(/\s+/)[0]?.toUpperCase() ?? "";
  // Exempt when the exporter already vouched for this exact qty / price / value
  // combo at the gate — a legitimate FOB discount/multi-item confirms in one pass.
  const reconConfirmed =
    confirmed["value_amount"] === stated &&
    confirmed["quantity"] === get("quantity") &&
    confirmed["unit_price"] === get("unit_price");
  if (
    GOODS_VALUE_INCOTERMS.has(reconCode) &&
    !ambiguous.has("value_amount") &&
    !reconConfirmed &&
    get("quantity") &&
    get("unit_price") &&
    get("unit_price_basis") &&
    stated
  ) {
    const computed = computeProposedValue(d);
    if (computed) {
      const statedNum = num(stated);
      const computedNum = num(computed.amount);
      if (
        statedNum !== null &&
        computedNum !== null &&
        computedNum > 0 &&
        Math.abs(statedNum - computedNum) / computedNum > 0.02
      ) {
        issues.push({
          field: "value_amount",
          reason: `Invoice value ${stated} doesn't match quantity × unit price (≈ ${computed.amount}). Please confirm`,
        });
      }
    }
  }

  const currency = get("value_currency");
  if (currency && !/^[A-Za-z]{3}$/.test(currency)) {
    issues.push({ field: "value_currency", reason: "Currency is not a 3-letter code" });
  }

  // Quantity UNIT must actually look like a unit — a bare number or symbols
  // ("1000" of WHAT) can't ride onto a customs document. Any WORD unit passes
  // (kg, MT, pcs, bags, cartons, drums… — trade units vary too much for an
  // allowlist, and mapping to the official UQC is the CHA's call, not ours);
  // only a unit with no letters at all is flagged. Exempt one the exporter
  // already confirmed as-is, so it doesn't loop the verify gate.
  const qtyUnit = get("quantity_unit");
  if (qtyUnit && !/[a-zA-Z]/.test(qtyUnit) && confirmed["quantity_unit"] !== qtyUnit) {
    issues.push({
      field: "quantity_unit",
      reason: `Quantity unit "${qtyUnit}" doesn't look like a unit — reply with the unit your PO uses (kg, MT, pcs, bags, cartons…)`,
    });
  }

  // Incoterms are usually written with a place ("CIF Rotterdam") — validate
  // the code itself, the first word only.
  const incoterm = get("incoterm");
  const incotermCode = incoterm.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (incoterm && !INCOTERMS.has(incotermCode)) {
    issues.push({ field: "incoterm", reason: `Incoterm "${incoterm}" is not a recognised term` });
  }

  // Indian customs filing (shipping bill) needs the 8-digit ITC-HS code. Buyer POs
  // legitimately carry the 6-digit international HS, so this is flag-and-ask, not a
  // hard reject: a present code that isn't exactly 8 digits (after stripping dots /
  // spaces) asks the exporter for the full 8-digit code; a non-numeric code is a
  // plain correction.
  const hs = get("hs_code");
  if (hs) {
    const hsDigits = hs.replace(/[.\s]/g, "");
    if (!/^\d+$/.test(hsDigits)) {
      issues.push({ field: "hs_code", reason: "HS code should be digits only" });
    } else if (hsDigits.length !== 8) {
      issues.push({
        field: "hs_code",
        reason: `Indian customs filing needs the 8-digit ITC-HS code — this looks like ${hsDigits.length} digits; reply with the full 8-digit code`,
      });
    }
  }

  return issues;
}

// Optional, display-only fields: never allowed to gate a shipment. A date the
// model wasn't sure about (e.g. an ambiguous DD/MM/YYYY it reformatted) shows
// as-is for the exporter/CHA to eyeball — blocking document generation over an
// informational field would be worse than the uncertainty itself.
const CONFIDENCE_EXEMPT = new Set(["po_date", "shipment_deadline"]);

// Fields whose extraction confidence is below threshold — they may be right,
// but the agent is not allowed to act on them without a human look.
export function lowConfidenceFields(
  d: Record<string, string>,
  confidence: Partial<PoConfidence>
): string[] {
  const flagged: string[] = [];
  for (const [key, c] of Object.entries(confidence)) {
    if (CONFIDENCE_EXEMPT.has(key)) continue;
    const value = (d[key] ?? "").trim();
    if (!value) continue; // blank fields are gap-fill's job
    const threshold = CONFIDENCE_THRESHOLDS[key] ?? DEFAULT_CONFIDENCE_THRESHOLD;
    if (typeof c === "number" && c < threshold) flagged.push(key);
  }
  return flagged;
}

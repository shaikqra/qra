import { labelsFor } from "./required-fields";
import { computeProposedValue } from "./compute-value";

// Build the bullet list of missing fields for a gap-fill WhatsApp message.
// If the invoice value is missing but computable from a stated unit price,
// the value line becomes a proposal the customer can confirm.
export function missingFieldLines(missing: string[], d: Record<string, string>): string[] {
  const computed = missing.includes("value_amount") ? computeProposedValue(d) : null;
  return missing.map((k) => {
    if (k === "value_amount" && computed) {
      return `• Invoice value — I calculate ${computed.explanation}. Reply CONFIRM to use it, or send the correct amount.`;
    }
    return `• ${labelsFor([k])[0]}`;
  });
}

// Whether a customer reply is a plain confirmation of a proposed value.
const CONFIRM_PHRASES = new Set([
  "confirm", "confirmed", "yes", "yes confirm", "yes correct", "correct",
  "thats correct", "that is correct", "right", "thats right", "use it",
  "use that", "ok", "okay", "yep", "yeah", "agreed", "sounds good", "fine",
]);

// Whole-message match only (like isApprovalMessage). "confirm but change qty to
// 5000" must NOT count as a confirmation — it carries a correction we'd drop.
export function isValueConfirmation(body: string): boolean {
  const norm = body
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return CONFIRM_PHRASES.has(norm);
}

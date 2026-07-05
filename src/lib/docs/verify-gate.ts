// The G1 verify gate (blueprint §4: "the extracted order is correct").
// When extraction is uncertain or a field looks malformed, the EXPORTER — not the
// internal operator — verifies or corrects it. This module builds the message we
// show them (on WhatsApp and in the portal) and the helpers around it. It is pure
// (no DB / Twilio) so both the auto-pipeline and the webhook can share it.

import type { ValidationIssue } from "@/lib/docs/validate";

// Human labels for every field the verify gate might surface. Covers the required
// fields plus the money/customs/packing fields the trust gate checks.
const FIELD_LABELS: Record<string, string> = {
  buyer_name: "Buyer",
  product_description: "Goods",
  quantity: "Quantity",
  value_amount: "Invoice value",
  unit_price: "Unit price",
  value_currency: "Currency",
  incoterm: "Incoterm",
  hs_code: "HS code",
  number_of_packages: "Number of packages",
  package_type: "Package type",
  net_weight: "Net weight",
  gross_weight: "Gross weight",
};

function label(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

// Public field label — the exporter console uses it to title the correction
// inputs in the verify pop-up, so they match the WhatsApp wording exactly.
export function fieldLabel(field: string): string {
  return label(field);
}

// Read the per-field extraction confidence we stash under the reserved key.
export function readStoredConfidence(merged: Record<string, string>): Record<string, number> {
  try {
    return JSON.parse(merged["_confidence"] ?? "{}");
  } catch {
    return {};
  }
}

// Fields Qra DRAFTED (not extracted) — e.g. an HS code worked out from the goods
// when the PO carried none. Stashed under a reserved key so every surface that
// builds the verify message can word them honestly ("I worked this out") rather
// than as something we read off the PO.
export function readDraftedFields(merged: Record<string, string>): string[] {
  try {
    const v = JSON.parse(merged["_drafted"] ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Fields Qra NEEDS the exporter to PROVIDE — missing and not derivable (e.g. an HS
// code the classifier couldn't work out). The verify gate asks for them instead of
// silently skipping the documents that require them.
export function readNeededFields(merged: Record<string, string>): string[] {
  try {
    const v = JSON.parse(merged["_needed"] ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// One line per field the exporter should check. A malformed field (a validation
// issue) needs a real correction; a merely low-confidence field just needs a
// yes/no. An issue takes priority over a low-confidence flag on the same field.
export function verifyFieldLines(
  merged: Record<string, string>,
  issues: ValidationIssue[],
  shaky: string[]
): string[] {
  const lines: string[] = [];
  const issueFields = new Set(issues.map((i) => i.field));
  const drafted = new Set(readDraftedFields(merged));
  const needed = new Set(readNeededFields(merged));
  for (const issue of issues) {
    const v = (merged[issue.field] ?? "").trim() || "—";
    lines.push(`• ${label(issue.field)}: ${v} — ${issue.reason}. Please send the correct value.`);
  }
  // Low-confidence/drafted fields PLUS any "needed" fields Qra must be given.
  for (const field of Array.from(new Set([...shaky, ...needed]))) {
    if (issueFields.has(field)) continue; // already listed with its reason
    const v = (merged[field] ?? "").trim() || "—";
    if (needed.has(field)) {
      // Missing and not derivable — ask the exporter to provide it (never skip silently).
      lines.push(`• ${label(field)} — I couldn't read this from your goods. Please reply with it.`);
    } else if (drafted.has(field)) {
      // A field Qra worked out itself (not on the PO) is worded so the exporter
      // confirms the GOODS and passes the code to their CHA — never asked to certify
      // a classification they can't judge.
      lines.push(
        `• ${label(field)}: ${v} — Qra suggested this from your goods; your PO didn't carry one. It affects your duty and RoDTEP, so your CHA confirms it before filing. If you already know the right code, send it; otherwise reply CONFIRM and we'll mark it a draft for your CHA.`
      );
    } else {
      lines.push(`• ${label(field)}: ${v} — is this right?`);
    }
  }
  return lines;
}

// The full WhatsApp message asking the exporter to verify-or-correct. Shared by
// the auto-pipeline (sent via Twilio) and the webhook (returned as the reply).
export function verifyAskMessage(
  ref: string,
  merged: Record<string, string>,
  issues: ValidationIssue[],
  shaky: string[]
): string {
  const lines = verifyFieldLines(merged, issues, shaky);
  return (
    `📋 Quick check on your PO (ref ${ref}) before I draft your documents — ` +
    `please confirm I read these correctly:\n` +
    lines.join("\n") +
    `\n\nReply CONFIRM if they're right, or just send the correct value.`
  );
}

// The field keys an exporter's reply might correct — used to parse their answer.
export function flaggedFieldKeys(issues: ValidationIssue[], shaky: string[]): string[] {
  return Array.from(new Set([...issues.map((i) => i.field), ...shaky]));
}

// Like flaggedFieldKeys, but also includes the "needed" fields Qra is asking the
// exporter to PROVIDE — so their reply (e.g. an HS code) is parsed + the console
// pop-up shows an input for it.
export function verifyKeys(
  merged: Record<string, string>,
  issues: ValidationIssue[],
  shaky: string[]
): string[] {
  return Array.from(new Set([...issues.map((i) => i.field), ...shaky, ...readNeededFields(merged)]));
}

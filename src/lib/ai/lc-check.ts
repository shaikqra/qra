import Anthropic from "@anthropic-ai/sdk";

// Qra's Letter-of-Credit examiner (Documents agent, §12). Given the LC terms and
// the shipment's document data, it lists DISCREPANCIES the way a bank would —
// pinned to a field, with what the LC requires vs what the docs show, and a
// suggested fix. ADVISORY: it flags, a human resolves, the bank is the authority.
// It never auto-fixes and never invents an LC term the text doesn't state.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type LcDiscrepancy = {
  field: string;
  severity: "high" | "medium" | "low";
  lcRequires: string;
  documentsShow: string;
  suggestion: string;
};

// Identifying details lifted verbatim from the LC — used to build the bank
// presentation cover letter. Empty string when the LC does not state one.
export type LcMeta = {
  lc_number: string;
  issuing_bank: string;
  applicant: string;
};

const SYSTEM_PROMPT = `You are Qra's Letter-of-Credit examiner for Indian exporters, applying UCP 600. You are given (1) the LC terms and (2) the shipment's document data — structured facts, today's date, the invoice date (if generated), and the list of documents Qra has generated for this shipment. List every DISCREPANCY — any place the documents or timeline would FAIL to comply with the LC.

For each discrepancy give: the field/clause, a severity (high/medium/low), what the LC REQUIRES, what the DOCUMENTS show, and a concrete suggested fix.

FIELD DATA — watch for (only what the structured facts support): applicant / consignee / beneficiary name mismatch; amount or currency mismatch / over-drawing; HS code or quantity mismatch; incoterm or port mismatch; insurance coverage BELOW 110% of the CIF/CIP value — 110% is the MINIMUM, higher coverage is acceptable and must not be flagged (only if the LC requires insurance under a CIF/CIP term).

DATES — compare the LC's expiry date, latest shipment date, and presentation period against today's date and any shipment/delivery date given. If the LC is silent on the presentation period, apply the UCP 600 Art. 14(c) default of 21 calendar days after the shipment date, but never later than LC expiry (this default applies when the presentation includes an original transport document, which nearly every goods export does). Flag: the LC has already EXPIRED; the latest shipment date has already PASSED; the latest shipment date is within 7 days (severity by how tight the window is); or expiry falls too close to the latest shipment date to leave a realistic presentation window. The ACTUAL shipment date is unknown before shipment (no bill of lading exists yet), so treat every date finding as a TIMELINE WARNING about the schedule — not as a document discrepancy — and say so in the finding. Do not raise a finding merely because the shipment date is not yet known — that is expected before shipment. Also read the LC's place of expiry / place for presentation (field 31D): if the credit expires at the counters of a bank OUTSIDE India (e.g. the issuing bank abroad), warn that the documents must REACH that bank before expiry — the effective India-side presentation deadline is earlier than the printed expiry by the courier transit time. Flag this as a timeline warning.

REQUIRED DOCUMENTS — read the LC's required-documents clause (field 46A, or prose listing the documents to present). Compare it against the list of documents Qra has generated for this shipment. For each document the LC requires that is NOT in the generated list, flag it. If it is a third-party document Qra does not issue — bill of lading (from the carrier), insurance certificate or policy (from the insurer), certificate of analysis (from a lab), inspection certificate (from an inspection agency) — say so in the suggestion ("obtain from the carrier / insurer / lab — Qra does not issue this"), not as if Qra failed to generate it. If the LC states copy/original counts, remind the operator to ensure those counts at presentation — the generated-document list carries NO counts, so never assert a specific shortfall.

CROSS-DOCUMENT WORDING — per UCP 600 Art. 18(c) the commercial INVOICE's goods description must CORRESPOND with the description in the LC; all other documents may use general terms not inconsistent with the LC (Art. 14(e)). Every Qra-generated document prints the SAME goods description from one source, so judge that single description against the LC's exact wording using the invoice-correspondence standard. Only when the wording actually differs, flag it — and note that because all Qra documents carry the same wording, the difference appears on all of them. Do NOT invent per-document wording differences you cannot see.

You were given the shipment's structured facts and the list of documents generated — NOT the full rendered text of each document. So base document-presence and wording findings on the goods description and generated-document list you were given; do not assume line-by-line contents you cannot see, and do not flag wording on documents whose text you were not shown.

LC METADATA — also lift three identifying fields, VERBATIM from the LC text, for a documents-presentation cover letter: the LC / documentary-credit number (field 20 or the stated credit no.); the ISSUING BANK's name; and the APPLICANT (the buyer on whose behalf the credit was opened, field 50). Copy each exactly as the LC states it. If the LC does not state one, leave it an empty string. Never guess, infer, or reformat these — extraction only.

Rules:
- Flag ONLY real discrepancies supported by the data given. Do NOT invent LC terms that are not stated, and do NOT flag something the LC is silent on.
- ADVISORY only — a human (and the bank) resolves each; you never auto-fix.
- If everything the data lets you check complies, return an empty list.`;

export async function checkLcDiscrepancies(
  lcText: string,
  documentFacts: string
): Promise<{ discrepancies: LcDiscrepancy[]; meta: LcMeta } | null> {
  if (!lcText.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_discrepancies",
            description: "Record the LC discrepancies found, plus the LC's identifying details.",
            input_schema: {
              type: "object",
              properties: {
                discrepancies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string", description: "the field / clause" },
                      severity: { type: "string", enum: ["high", "medium", "low"] },
                      lc_requires: { type: "string", description: "what the LC requires" },
                      documents_show: { type: "string", description: "what the documents show" },
                      suggestion: { type: "string", description: "a concrete fix" },
                    },
                    required: ["field", "severity", "lc_requires", "documents_show", "suggestion"],
                    additionalProperties: false,
                  },
                },
                lc_number: { type: "string", description: "the LC / documentary-credit number, verbatim; empty if not stated" },
                issuing_bank: { type: "string", description: "the issuing bank name, verbatim; empty if not stated" },
                applicant: { type: "string", description: "the applicant / buyer named in the LC, verbatim; empty if not stated" },
              },
              required: ["discrepancies"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_discrepancies" },
        messages: [
          {
            role: "user",
            content: `LETTER OF CREDIT TERMS:\n${lcText.slice(0, 10000)}\n\nSHIPMENT DOCUMENT DATA:\n${documentFacts.slice(0, 3000)}`,
          },
        ],
      },
      { timeout: 45_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = (toolUse?.input ?? {}) as {
      discrepancies?: unknown;
      lc_number?: unknown;
      issuing_bank?: unknown;
      applicant?: unknown;
    };
    const list = Array.isArray(raw.discrepancies) ? raw.discrepancies : [];
    const out: LcDiscrepancy[] = [];
    for (const d of list.slice(0, 30)) {
      const o = (d ?? {}) as Record<string, unknown>;
      const field = String(o.field ?? "").trim().slice(0, 120);
      if (!field) continue;
      const sev = String(o.severity ?? "").toLowerCase();
      out.push({
        field,
        severity: sev === "high" || sev === "medium" || sev === "low" ? sev : "medium",
        lcRequires: String(o.lc_requires ?? "").trim().slice(0, 300),
        documentsShow: String(o.documents_show ?? "").trim().slice(0, 300),
        suggestion: String(o.suggestion ?? "").trim().slice(0, 300),
      });
    }
    const meta: LcMeta = {
      lc_number: String(raw.lc_number ?? "").trim().slice(0, 100),
      issuing_bank: String(raw.issuing_bank ?? "").trim().slice(0, 160),
      applicant: String(raw.applicant ?? "").trim().slice(0, 200),
    };
    return { discrepancies: out, meta };
  } catch (e) {
    console.error("checkLcDiscrepancies_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

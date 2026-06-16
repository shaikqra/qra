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

const SYSTEM_PROMPT = `You are Qra's Letter-of-Credit examiner for Indian exporters, applying UCP 600. You are given (1) the LC terms and (2) the shipment's document data. List every DISCREPANCY — any place the documents would FAIL to comply with the LC.

For each discrepancy give: the field/clause, a severity (high/medium/low), what the LC REQUIRES, what the DOCUMENTS show, and a concrete suggested fix.

Watch for (only what the structured data you are given can support): applicant / consignee / beneficiary name mismatch; amount or currency mismatch / over-drawing; HS code or quantity mismatch; incoterm or port mismatch; insurance not 110% (only if the LC requires insurance under a CIF/CIP term).
Goods description: the INVOICE description must match the LC; other documents only need to be "not inconsistent" with it (UCP 600 Art. 14(e)) — do not flag a general but consistent description.

You were NOT given dates, the list of required documents, or the exact wording of each document. So do NOT flag or assume: shipment / expiry / presentation dates, whether a required document is present, or cross-document wording. Those are out of scope for this check.

Rules:
- Flag ONLY real discrepancies visible from the structured data given. Do NOT invent LC terms that are not stated, and do NOT flag something the LC is silent on.
- ADVISORY only — a human (and the bank) resolves each; you never auto-fix.
- If the documents comply, return an empty list.`;

export async function checkLcDiscrepancies(lcText: string, documentFacts: string): Promise<LcDiscrepancy[] | null> {
  if (!lcText.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_discrepancies",
            description: "Record the LC discrepancies found.",
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
            content: `LETTER OF CREDIT TERMS:\n${lcText.slice(0, 6000)}\n\nSHIPMENT DOCUMENT DATA:\n${documentFacts.slice(0, 3000)}`,
          },
        ],
      },
      { timeout: 45_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = (toolUse?.input ?? {}) as { discrepancies?: unknown };
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
    return out;
  } catch (e) {
    console.error("checkLcDiscrepancies_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

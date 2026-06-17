import Anthropic from "@anthropic-ai/sdk";
import { validateExtracted } from "@/lib/docs/validate";

// The "brain" of the document-review experience. Combines the deterministic
// rule checks (validateExtracted — instant, free, authoritative) with an AI
// judgment pass for the subtler discrepancies rules can't catch. ADVISORY only:
// it flags things for the licensed broker to verify — it never decides, and it
// deliberately does NOT opine on regulatory requirements (that needs the
// validated Trade Graph, which doesn't exist yet).

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type DocReviewFlag = {
  severity: "high" | "medium" | "low";
  field: string;
  issue: string;
  suggestion: string;
  source: "rule" | "ai";
};

const SYSTEM_PROMPT = `You review the DATA behind an Indian exporter's export documents (commercial invoice, packing list, certificate of origin and similar) before a licensed customs broker files them. Your job is to flag genuine DATA problems the broker should check or correct — NOT to advise on regulations or which documents are required.

Flag things like:
- Party gaps or inconsistencies: a blank consignee, or buyer / consignee / notify party that look inconsistent.
- HS code vs goods: an HS code that does not plausibly match the product description.
- Numeric plausibility and internal consistency: gross weight below net weight; a total value that doesn't fit the quantity and unit price; quantities or weights that look wrong for the goods; a malformed currency.
- Incoterm vs ports or currency mismatches.
- An obviously missing critical field (e.g. no port of discharge on a CIF shipment).

For each issue give: the field name, a one-line description of the issue, a concrete suggested fix, and a severity — "high" (likely wrong / would cause a customs problem), "medium" (worth verifying), or "low" (minor).

Rules:
- Flag ONLY genuine problems. If the data looks clean, return an empty list. Never invent issues or nitpick values that are fine.
- Do NOT advise on regulatory requirements, required certificates, licences, or duties — that is out of scope.
- You are advisory; the licensed broker verifies and decides.`;

function buildTool(): Anthropic.Tool {
  return {
    name: "record_document_flags",
    description: "Record data discrepancies found in the export shipment, for the broker to verify.",
    input_schema: {
      type: "object",
      properties: {
        flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["high", "medium", "low"] },
              field: { type: "string", description: "The field or area the issue is about" },
              issue: { type: "string", description: "One line: what's wrong or to check" },
              suggestion: { type: "string", description: "A concrete suggested fix" },
            },
            required: ["severity", "field", "issue", "suggestion"],
            additionalProperties: false,
          },
        },
      },
      required: ["flags"],
      additionalProperties: false,
    },
  };
}

function fieldsBlock(data: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("_")) continue; // reserved internal state (_confidence/_drafted/_certifications…) — not a document field
    const val = (v ?? "").toString().trim();
    if (val) lines.push(`${k}: ${val}`);
  }
  return lines.join("\n").slice(0, 4000);
}

const SEVERITIES = new Set(["high", "medium", "low"]);

// Rule issues aren't all equally serious — a bad number or gross<net is high,
// but a mis-formatted HS code or currency is "verify" not "blocker". Keeping
// these distinct avoids alert-fatigue where everything is red.
const RULE_SEVERITY: Record<string, DocReviewFlag["severity"]> = {
  hs_code: "medium",
  incoterm: "medium",
  value_currency: "medium",
};

export async function reviewDocuments(data: Record<string, string>): Promise<DocReviewFlag[]> {
  // 1. Deterministic rule flags — instant, free, authoritative.
  const ruleFlags: DocReviewFlag[] = validateExtracted(data).map((i) => ({
    severity: RULE_SEVERITY[i.field] ?? "high",
    field: i.field,
    issue: i.reason,
    suggestion: "Correct this value before filing.",
    source: "rule",
  }));

  // 2. AI judgment flags — the subtler discrepancies. Best-effort: if the model
  //    call fails, the rule flags still stand.
  let aiFlags: DocReviewFlag[] = [];
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: [buildTool()],
        tool_choice: { type: "tool", name: "record_document_flags" },
        messages: [
          {
            role: "user",
            content: `Review this export shipment's document data:\n\n${fieldsBlock(data)}`,
          },
        ],
      },
      // Don't let a slow upstream hang the broker's "Run check" — degrade to
      // rule-only flags on timeout.
      { timeout: 30_000 }
    );
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const raw = (toolUse?.input ?? {}) as { flags?: unknown };
    const arr = Array.isArray(raw.flags) ? raw.flags : [];
    aiFlags = arr
      .slice(0, 12)
      .map((f): DocReviewFlag => {
        const o = (f ?? {}) as Record<string, unknown>;
        const sev = typeof o.severity === "string" && SEVERITIES.has(o.severity)
          ? (o.severity as DocReviewFlag["severity"])
          : "medium";
        return {
          severity: sev,
          field: String(o.field ?? "").slice(0, 80),
          issue: String(o.issue ?? "").slice(0, 300),
          suggestion: String(o.suggestion ?? "").slice(0, 300),
          source: "ai",
        };
      })
      .filter((f) => f.issue !== "");
  } catch (e) {
    console.error("reviewDocuments_ai_failed", e instanceof Error ? e.name : "unknown");
  }

  return [...ruleFlags, ...aiFlags];
}

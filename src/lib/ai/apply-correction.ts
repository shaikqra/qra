import Anthropic from "@anthropic-ai/sdk";
import { PO_FIELD_KEYS } from "@/lib/ai/extract-po";

// The "redraft" brain of the §12 review loop. Given the shipment's current data
// and a reviewer instruction (a flag's fix, or free text like "change the buyer
// to Acme GmbH"), it returns the SINGLE field to change and its corrected value.
// Schema-bound to real field keys so the result is always applicable — never
// prose. Returns null if it can't produce a confident, concrete change.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type Correction = { field: string; value: string };

const SYSTEM_PROMPT = `You correct ONE data field on an Indian export shipment, from a reviewer's instruction. Return the single field key to change and its corrected value.
Rules:
- Choose the field key that best matches the instruction.
- The value must be a concrete replacement, formatted like the existing data (plain numbers without thousands separators or units; a 3-letter ISO currency code; an Incoterm like CIF; an HS code as digits).
- Only act if the instruction clearly implies a specific new value. If it's vague or you'd have to invent the value, do not guess.`;

export async function proposeCorrection(
  data: Record<string, string>,
  instruction: string
): Promise<Correction | null> {
  const fieldsBlock = Object.entries(data)
    .filter(([k, v]) => k !== "_confidence" && (v ?? "").trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
    .slice(0, 3000);

  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "set_field",
            description: "Set one shipment field to a corrected value.",
            input_schema: {
              type: "object",
              properties: {
                field: { type: "string", enum: [...PO_FIELD_KEYS] },
                value: { type: "string", description: "The corrected value, formatted like the existing data" },
              },
              required: ["field", "value"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "set_field" },
        messages: [
          {
            role: "user",
            content: `Current shipment data:\n${fieldsBlock}\n\nReviewer instruction: ${instruction.slice(0, 500)}`,
          },
        ],
      },
      { timeout: 30_000 }
    );

    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const o = (toolUse?.input ?? {}) as { field?: unknown; value?: unknown };
    const field = String(o.field ?? "");
    const value = String(o.value ?? "").trim().slice(0, 200);
    if (!(PO_FIELD_KEYS as readonly string[]).includes(field) || !value) return null;
    return { field, value };
  } catch (e) {
    console.error("proposeCorrection_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

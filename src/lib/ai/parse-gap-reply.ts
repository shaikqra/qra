import Anthropic from "@anthropic-ai/sdk";
import { REQUIRED_FIELD_LABELS } from "@/lib/docs/required-fields";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `A customer was asked, on WhatsApp, to provide missing shipment fields for their export documents. You read their reply and pull out ONLY the requested fields.

Rules:
- Fill a field ONLY if the reply clearly states it. Otherwise return an empty string "" for it. Never guess.
- Numbers (quantity, value_amount, net_weight, gross_weight, number_of_packages): digits only, no commas, units, or currency symbols.
- value_currency: a 3-letter ISO code (USD, EUR, INR...).
- hs_code: the HS / HSN tariff code as digits (e.g. 09083120); drop any dots or spaces.
- A blank field is better than a wrong one.`;

// Descriptions for fields the verify gate may ask for that are NOT in the required
// set — so the parser knows what they are, without making them globally required.
const EXTRA_HINTS: Record<string, string> = {
  hs_code: "HS / HSN tariff code — digits only (e.g. 09083120)",
  incoterm: "Incoterm (FOB, CIF, CFR, EXW, DAP...)",
  unit_price: "Per-unit price as a plain number, no thousands separators (e.g. 1635 or 0.80)",
  destination_country: "Destination country — where the goods are shipped to (e.g. Germany, USA, Netherlands)",
};

// Read the customer's free-text reply and extract values for the fields we
// asked them for. Only the missing keys are in the tool schema, so the model
// cannot touch fields that were already filled.
export async function parseGapReply(
  replyText: string,
  missingKeys: string[]
): Promise<Record<string, string>> {
  const properties: Record<string, { type: "string"; description: string }> = {};
  for (const key of missingKeys) {
    properties[key] = {
      type: "string",
      description: REQUIRED_FIELD_LABELS[key] ?? EXTRA_HINTS[key] ?? key,
    };
  }

  const message = await anthropic.messages.create(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: "record_fields",
          description: "Record the shipment fields found in the customer's reply.",
          input_schema: {
            type: "object",
            properties,
            required: missingKeys,
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_fields" },
      messages: [{ role: "user", content: replyText }],
    },
    { timeout: 30_000 }
  );

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  const raw = (toolUse?.input ?? {}) as Record<string, unknown>;

  const NO_DATA = /^(<?\s*unknown\s*>?|n\/?a|none|null|nil|not\s+(stated|available|specified|mentioned|provided|found)|tbd|[-—.]+)$/i;

  const fields: Record<string, string> = {};
  for (const key of missingKeys) {
    const v = raw[key];
    const cleaned = typeof v === "string" ? v.trim() : "";
    if (cleaned && !NO_DATA.test(cleaned)) fields[key] = cleaned;
  }
  return fields;
}

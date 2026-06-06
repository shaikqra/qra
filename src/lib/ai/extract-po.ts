import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The fields we try to read off a buyer's purchase order. Same keys as the
// dashboard's extraction form, so results drop straight into it.
export const PO_FIELD_KEYS = [
  "buyer_name",
  "buyer_address",
  "destination_country",
  "hs_code",
  "product_description",
  "quantity",
  "quantity_unit",
  "value_amount",
  "value_currency",
  "incoterm",
] as const;

export type PoFields = Record<(typeof PO_FIELD_KEYS)[number], string>;

export type SupportedMediaType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const SYSTEM_PROMPT = `You read a buyer's purchase order for an Indian export shipment and extract structured fields.

Rules:
- Extract ONLY what is clearly present in the document. If a field is not stated, return an empty string "" for it. Do NOT write "UNKNOWN", "N/A", "-", "not stated", or any other placeholder — use a literal empty string. Never guess or invent values.
- Do NOT fabricate an HS code. Only fill hs_code if an HS/HSN/tariff code is explicitly written on the document.
- value_amount: the total order value as a plain number, digits only (no currency symbol, no commas). If only a unit price is shown, leave value_amount empty.
- value_currency: a 3-letter ISO code (USD, EUR, INR, AED, GBP).
- quantity: a plain number. quantity_unit: the unit (kg, MT, pcs, cartons, etc.).
- destination_country: the country the goods ship to.
- incoterm: e.g. FOB, CIF, CFR, EXW, DAP.
Accuracy matters more than completeness — a blank field is better than a wrong one.`;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_po_fields",
  description: "Record the export shipment fields extracted from the purchase order.",
  input_schema: {
    type: "object",
    properties: {
      buyer_name: { type: "string", description: "Buyer / importer company name" },
      buyer_address: { type: "string", description: "Buyer's full address" },
      destination_country: { type: "string", description: "Country the goods ship to" },
      hs_code: { type: "string", description: "HS/HSN/tariff code, only if explicitly written" },
      product_description: { type: "string", description: "Description of the goods" },
      quantity: { type: "string", description: "Quantity as a plain number" },
      quantity_unit: { type: "string", description: "Unit of quantity (kg, MT, pcs...)" },
      value_amount: { type: "string", description: "Total order value, digits only" },
      value_currency: { type: "string", description: "3-letter ISO currency code" },
      incoterm: { type: "string", description: "Incoterm (FOB, CIF, EXW...)" },
    },
    required: [...PO_FIELD_KEYS],
    additionalProperties: false,
  },
};

// Read a single PO file (PDF or image) and return the extracted fields.
export async function extractPoFields(
  base64: string,
  mediaType: SupportedMediaType
): Promise<PoFields> {
  const fileBlock: Anthropic.ContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_po_fields" },
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Extract the export shipment fields from this purchase order." },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  const raw = (toolUse?.input ?? {}) as Record<string, unknown>;

  // Some models write a placeholder instead of an empty string when a field is
  // missing. Treat any "no data" marker as blank so it never pollutes the form.
  const NO_DATA = /^(<?\s*unknown\s*>?|n\/?a|none|null|nil|not\s+(stated|available|specified|mentioned|provided|found)|tbd|[-—.]+)$/i;

  const fields = {} as PoFields;
  for (const key of PO_FIELD_KEYS) {
    const v = raw[key];
    const cleaned = typeof v === "string" ? v.trim() : "";
    fields[key] = NO_DATA.test(cleaned) ? "" : cleaned;
  }
  return fields;
}

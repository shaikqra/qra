import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Every field we try to read off an export document. Same keys as the
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
  "number_of_packages",
  "package_type",
  "net_weight",
  "gross_weight",
  "weight_unit",
  "port_of_loading",
  "port_of_discharge",
  "vessel_name",
  "container_no",
  "seal_no",
  "batch_code",
  "lot_code",
] as const;

export type PoFields = Record<(typeof PO_FIELD_KEYS)[number], string>;

export type SupportedMediaType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const SYSTEM_PROMPT = `You read an Indian export document (a buyer purchase order, proforma, or commercial invoice) and extract structured fields.

Rules:
- Extract ONLY what is clearly present in the document. If a field is not stated, return an empty string "" for it. Do NOT write "UNKNOWN", "N/A", "-", "not stated", or any placeholder — use a literal empty string. Never guess or invent values.
- Do NOT fabricate an HS code. Only fill hs_code if an HS/HSN/tariff code is explicitly written.
- Numbers (quantity, value_amount, net_weight, gross_weight, number_of_packages): digits only, no commas, no currency symbol, no unit.
- value_currency: a 3-letter ISO code (USD, EUR, INR, AED, GBP).
- quantity_unit / weight_unit: the unit shown (kg, MT, pcs).
- package_type: the kind of package (Carton Box, PP bags, pallets, drums...).
- destination_country: the country the goods ship to.
- incoterm: e.g. FOB, CIF, CFR, EXW, DAP.
- container_no, seal_no, batch_code, lot_code, port_of_loading, port_of_discharge, vessel_name: copy exactly as printed if present, else blank.
Accuracy matters more than completeness — a blank field is better than a wrong one.`;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_po_fields",
  description: "Record the export shipment fields extracted from the document.",
  input_schema: {
    type: "object",
    properties: {
      buyer_name: { type: "string", description: "Buyer / importer / consignee company name" },
      buyer_address: { type: "string", description: "Buyer's full address" },
      destination_country: { type: "string", description: "Country the goods ship to" },
      hs_code: { type: "string", description: "HS/HSN/tariff code, only if explicitly written" },
      product_description: { type: "string", description: "Description of the goods" },
      quantity: { type: "string", description: "Quantity as a plain number" },
      quantity_unit: { type: "string", description: "Unit of quantity (kg, MT, pcs...)" },
      value_amount: { type: "string", description: "Total order/invoice value, digits only" },
      value_currency: { type: "string", description: "3-letter ISO currency code" },
      incoterm: { type: "string", description: "Incoterm (FOB, CIF, EXW...)" },
      number_of_packages: { type: "string", description: "Total number of packages/cartons, plain number" },
      package_type: { type: "string", description: "Kind of package (Carton Box, PP bags, pallets...)" },
      net_weight: { type: "string", description: "Total net weight, plain number" },
      gross_weight: { type: "string", description: "Total gross weight, plain number" },
      weight_unit: { type: "string", description: "Weight unit (kg, MT)" },
      port_of_loading: { type: "string", description: "Port of loading, as printed" },
      port_of_discharge: { type: "string", description: "Port of discharge, as printed" },
      vessel_name: { type: "string", description: "Vessel / voyage name, if stated" },
      container_no: { type: "string", description: "Container number, as printed" },
      seal_no: { type: "string", description: "Seal number, as printed" },
      batch_code: { type: "string", description: "Batch / production code, as printed" },
      lot_code: { type: "string", description: "Lot number, as printed" },
    },
    required: [...PO_FIELD_KEYS],
    additionalProperties: false,
  },
};

// Read a single export document (PDF or image) and return the extracted fields.
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
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_po_fields" },
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Extract the export shipment fields from this document." },
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

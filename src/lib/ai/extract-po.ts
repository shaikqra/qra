import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Every field we try to read off an export document. Same keys as the
// dashboard's extraction form, so results drop straight into it.
export const PO_FIELD_KEYS = [
  "buyer_name",
  "buyer_address",
  "consignee_name",
  "notify_party_name",
  "destination_country",
  "hs_code",
  "product_description",
  "quantity",
  "quantity_unit",
  "value_amount",
  "value_currency",
  "unit_price",
  "unit_price_basis",
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
export type PoConfidence = Record<(typeof PO_FIELD_KEYS)[number], number>;

const FIELD_DESCRIPTIONS: Record<(typeof PO_FIELD_KEYS)[number], string> = {
  buyer_name: "Buyer / importer company name (the party that pays)",
  buyer_address: "Buyer's full address",
  consignee_name: "Consignee — the party the goods are shipped TO, only if named and different from the buyer; else blank",
  notify_party_name: "Notify party named on the document, only if stated and different from the buyer; else blank",
  destination_country: "Country the goods ship to",
  hs_code: "HS/HSN/tariff code, only if explicitly written",
  product_description: "Description of the goods",
  quantity: "Quantity as a plain number",
  quantity_unit: "Unit of quantity (kg, MT, pcs...)",
  value_amount: "TOTAL order/invoice value, digits only. Only if a total is stated — never compute it from a unit price",
  value_currency: "3-letter ISO currency code",
  unit_price: "Per-unit price as a plain number, only if a unit/rate price is stated (e.g. 1635 from '1.635,00 USD / 1.000 KG'); else blank",
  unit_price_basis: "What the unit price is per, as plain digits + unit (no thousands separators): '1.000 KG' must become '1000 kg'. E.g. '1000 kg', 'kg', 'MT', 'piece'; else blank",
  incoterm: "Incoterm (FOB, CIF, EXW...). 'Costs and freight X' means CFR",
  number_of_packages: "Total number of packages/cartons/drums, plain number",
  package_type: "Kind of package (Carton Box, PP bags, drums, pallets...)",
  net_weight: "Total net weight, plain number",
  gross_weight: "Total gross weight, plain number",
  weight_unit: "Weight unit (kg, MT)",
  port_of_loading: "Port of loading, as printed",
  port_of_discharge: "Port of discharge, as printed",
  vessel_name: "Vessel / voyage name, if stated",
  container_no: "Container number, as printed",
  seal_no: "Seal number, as printed",
  batch_code: "Batch / production code, as printed",
  lot_code: "Lot number, as printed",
};

export type SupportedMediaType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const SYSTEM_PROMPT = `You read an Indian export document (a buyer purchase order, contract confirmation, proforma, or commercial invoice) and extract structured fields.

Rules:
- Extract ONLY what is clearly present in the document. If a field is not stated, return an empty string "" for it. Do NOT write "UNKNOWN", "N/A", "-", "not stated", or any placeholder — use a literal empty string. Never guess, compute, or invent values.
- Do NOT fabricate an HS code. Only fill hs_code if an HS/HSN/tariff code is explicitly written.
- Numbers (quantity, value_amount, net_weight, gross_weight, number_of_packages): output plain digits with at most one decimal point, no thousands separators, no currency symbol, no unit.
- NUMBER FORMATS — read carefully. European documents use "." for thousands and "," for decimals: "53.352 KG" means fifty-three thousand (output "53352"); "1.635,00 USD" means 1635.00 (output "1635.00"). Indian/US documents use "," for thousands: "53,352" also means fifty-three thousand. Use the magnitude that makes commercial sense for an export shipment and lower your confidence if ambiguous.
- value_amount is the TOTAL value only. If the document shows only a unit price (e.g. "per 1.000 KG"), leave value_amount blank — do not multiply.
- value_currency: a 3-letter ISO code (USD, EUR, INR, AED, GBP).
- quantity_unit / weight_unit: the unit shown (kg, MT, pcs).
- destination_country: the country the goods ship to (a named discharge city like Rotterdam implies its country).
- incoterm: e.g. FOB, CIF, CFR, EXW, DAP. Wording like "Costs and freight Rotterdam" means CFR.
- container_no, seal_no, batch_code, lot_code, port_of_loading, port_of_discharge, vessel_name: copy exactly as printed if present, else blank.

Confidence: for every field give a confidence between 0 and 1 — how certain you are the VALUE is correct as extracted. Use 0.95+ only when the value is printed plainly and unambiguously; 0.7–0.9 when you interpreted formatting, language or layout; below 0.7 when genuinely unsure. An empty field (not stated) gets confidence 1.0 — being sure it's absent counts.
Accuracy matters more than completeness — a blank field is better than a wrong one.`;

function buildExtractTool(): Anthropic.Tool {
  const properties: Record<string, unknown> = {};
  for (const key of PO_FIELD_KEYS) {
    properties[key] = {
      type: "object",
      properties: {
        value: { type: "string", description: FIELD_DESCRIPTIONS[key] },
        confidence: { type: "number", description: "0 to 1" },
      },
      required: ["value", "confidence"],
      additionalProperties: false,
    };
  }
  return {
    name: "record_po_fields",
    description: "Record the export shipment fields extracted from the document, each with a confidence score.",
    input_schema: {
      type: "object",
      properties,
      required: [...PO_FIELD_KEYS],
      additionalProperties: false,
    },
  };
}

// Some models write a placeholder instead of an empty string when a field is
// missing. Treat any "no data" marker as blank so it never pollutes the form.
const NO_DATA = /^(<?\s*unknown\s*>?|n\/?a|none|null|nil|not\s+(stated|available|specified|mentioned|provided|found)|tbd|[-—.]+)$/i;

function parseExtractTool(message: Anthropic.Message): {
  fields: PoFields;
  confidence: PoConfidence;
} {
  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  const raw = (toolUse?.input ?? {}) as Record<string, unknown>;

  const fields = {} as PoFields;
  const confidence = {} as PoConfidence;
  for (const key of PO_FIELD_KEYS) {
    const entry = (raw[key] ?? {}) as { value?: unknown; confidence?: unknown };
    const cleaned = typeof entry.value === "string" ? entry.value.trim() : "";
    fields[key] = NO_DATA.test(cleaned) ? "" : cleaned;
    const c = typeof entry.confidence === "number" ? entry.confidence : 0;
    confidence[key] = Math.max(0, Math.min(1, c));
  }
  return { fields, confidence };
}

// Read a single export document (PDF or image) and return extracted fields
// plus a per-field confidence map.
export async function extractPoFields(
  base64: string,
  mediaType: SupportedMediaType
): Promise<{ fields: PoFields; confidence: PoConfidence }> {
  const fileBlock: Anthropic.ContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    tools: [buildExtractTool()],
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

  return parseExtractTool(message);
}

// Read an order sent as plain text (a WhatsApp message or email body, not a
// file) and return the same extracted fields + confidence map.
export async function extractPoFieldsFromText(
  text: string
): Promise<{ fields: PoFields; confidence: PoConfidence }> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    tools: [buildExtractTool()],
    tool_choice: { type: "tool", name: "record_po_fields" },
    messages: [
      {
        role: "user",
        content: `Extract the export shipment fields from this order message:\n\n${text.slice(0, 4000)}`,
      },
    ],
  });

  return parseExtractTool(message);
}

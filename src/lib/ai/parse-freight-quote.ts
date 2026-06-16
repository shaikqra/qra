import Anthropic from "@anthropic-ai/sdk";

// Parse a carrier's RFQ reply into a structured freight quote. Extracts ONLY what
// the carrier explicitly states — never invents a rate or a number. Returns null
// on failure. (LLM proposes; the exporter decides at the G4 gate.)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ParsedQuote = {
  carrierName: string;
  rateAmount: number | null;
  rateCurrency: string;
  transitDays: number | null;
  freeDays: number | null;
  surcharges: string;
  validity: string;
};

const SYSTEM_PROMPT = `You extract a freight quote from a carrier's reply email for an Indian export shipment. Pull ONLY what the carrier explicitly states. If a field is not stated, leave it empty — NEVER guess or invent a rate or a number. Give numbers as digits only (no currency symbols or commas). Currency as a 3-letter code if stated (e.g. USD).`;

function toNum(v: unknown): number | null {
  const s = String(v ?? "").replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
}

export async function parseFreightQuote(rawText: string): Promise<ParsedQuote | null> {
  if (!rawText.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_quote",
            description: "Record the freight quote the carrier stated.",
            input_schema: {
              type: "object",
              properties: {
                carrier_name: { type: "string", description: "the carrier / line name, or empty" },
                rate_amount: { type: "string", description: "the all-in ocean freight rate, digits only, or empty" },
                rate_currency: { type: "string", description: "3-letter currency code, or empty" },
                transit_days: { type: "string", description: "transit time in days, digits only, or empty" },
                free_days: { type: "string", description: "free days (demurrage/detention), digits only, or empty" },
                surcharges: { type: "string", description: "any surcharges stated, or empty" },
                validity: { type: "string", description: "rate validity, or empty" },
              },
              required: ["carrier_name", "rate_amount", "rate_currency", "transit_days", "free_days", "surcharges", "validity"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_quote" },
        messages: [{ role: "user", content: rawText.slice(0, 4000) }],
      },
      { timeout: 30_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const o = (toolUse?.input ?? {}) as Record<string, unknown>;
    return {
      carrierName: String(o.carrier_name ?? "").trim().slice(0, 120),
      rateAmount: toNum(o.rate_amount),
      rateCurrency: String(o.rate_currency ?? "").trim().toUpperCase().slice(0, 3),
      transitDays: toInt(o.transit_days),
      freeDays: toInt(o.free_days),
      surcharges: String(o.surcharges ?? "").trim().slice(0, 500),
      validity: String(o.validity ?? "").trim().slice(0, 200),
    };
  } catch (e) {
    console.error("parseFreightQuote_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

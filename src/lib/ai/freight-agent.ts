import Anthropic from "@anthropic-ai/sdk";

// Qra's Freight agent. First capability: draft a carrier RFQ (Request for
// Quotation) from a shipment's cargo facts. DRAFT only — it proposes an email the
// exporter sends to their OWN carriers; it books nothing, holds no money, and
// invents nothing (no rates, no dates it wasn't given). "LLM proposes, humans
// approve." Next capabilities (separate builds): send → parse quote replies →
// rank → the G4 award gate.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type FreightRfqInput = {
  reference: string;
  product: string;
  quantity: string; // e.g. "25.54 MT"
  packages: string; // e.g. "112 steel drums"
  grossWeight: string; // e.g. "25536 kg"
  portOfLoading: string;
  portOfDischarge: string;
  destinationCountry: string;
  incoterm: string;
};

export type FreightRfq = { subject: string; body: string };

const SYSTEM_PROMPT = `You are Qra's Freight agent for Indian exporters. Draft a concise, professional Request for Quotation (RFQ) email to ocean carriers / freight forwarders, asking for a freight rate for the export shipment described.

Rules:
- Use ONLY the cargo facts provided. NEVER invent rates, dates, container counts, vessel names, or any detail you were not given. If a fact is missing, omit it — do not guess or use placeholders like [X].
- Ask the carrier to quote: ocean freight rate, transit time, free days (demurrage/detention), and any surcharges, with rate validity.
- Businesslike and brief (under ~180 words). End with a neutral sign-off (do not invent a company name).`;

export async function draftFreightRfq(input: FreightRfqInput): Promise<FreightRfq | null> {
  if (!input.product.trim()) return null;
  const facts = [
    `Reference: ${input.reference}`,
    input.product && `Commodity: ${input.product}`,
    input.quantity && `Quantity: ${input.quantity}`,
    input.packages && `Packing: ${input.packages}`,
    input.grossWeight && `Gross weight: ${input.grossWeight}`,
    input.portOfLoading && `Port of loading: ${input.portOfLoading}`,
    input.portOfDischarge && `Port of discharge: ${input.portOfDischarge}`,
    input.destinationCountry && `Destination: ${input.destinationCountry}`,
    input.incoterm && `Incoterm: ${input.incoterm}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_rfq",
            description: "Record the drafted RFQ email.",
            input_schema: {
              type: "object",
              properties: {
                subject: { type: "string", description: "the email subject line" },
                body: { type: "string", description: "the full RFQ email body" },
              },
              required: ["subject", "body"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_rfq" },
        messages: [{ role: "user", content: `Draft an RFQ for this shipment:\n${facts}` }],
      },
      { timeout: 30_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const o = (toolUse?.input ?? {}) as { subject?: unknown; body?: unknown };
    const subject = String(o.subject ?? "").trim().slice(0, 200);
    const body = String(o.body ?? "").trim().slice(0, 4000);
    if (!subject || !body) return null;
    return { subject, body };
  } catch (e) {
    console.error("draftFreightRfq_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

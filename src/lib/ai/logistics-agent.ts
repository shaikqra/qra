import Anthropic from "@anthropic-ai/sdk";

// Qra's Logistics agent. First capability: draft an inland-logistics booking
// request (truck to port, container, CFS slot, VGM weighing) for the shipment's
// cargo. DRAFT only — the operator reviews and sends; Qra books nothing and
// invents nothing (no dates, container numbers, or rates it wasn't given).

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type BookingInput = {
  reference: string;
  product: string;
  packages: string;
  grossWeight: string;
  portOfLoading: string;
  carrier: string;
};

export type BookingDraft = { subject: string; body: string };

const SYSTEM_PROMPT = `You are Qra's Logistics agent for Indian exporters. Draft a concise, professional email to a transporter / CFS / freight forwarder requesting the inland-logistics booking for an export shipment: a truck/trailer from the factory to the port of loading, a container, a CFS slot, and VGM (verified gross mass) weighing.

Rules:
- Use ONLY the cargo facts provided. NEVER invent dates, container numbers, vessel names, or rates. If a fact is missing, omit it — do not guess or use placeholders like [X].
- Ask the provider to confirm availability, the gate cut-off, and what they need from us to proceed.
- Businesslike and brief (under ~160 words). End with a neutral sign-off (do not invent a company name).`;

export async function draftBookingRequest(input: BookingInput): Promise<BookingDraft | null> {
  if (!input.product.trim()) return null;
  const facts = [
    `Reference: ${input.reference}`,
    input.product && `Commodity: ${input.product}`,
    input.packages && `Packing: ${input.packages}`,
    input.grossWeight && `Gross weight: ${input.grossWeight}`,
    input.portOfLoading && `Port of loading: ${input.portOfLoading}`,
    input.carrier && `Carrier (booked): ${input.carrier}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_booking",
            description: "Record the drafted booking-request email.",
            input_schema: {
              type: "object",
              properties: {
                subject: { type: "string", description: "the email subject line" },
                body: { type: "string", description: "the full booking-request email body" },
              },
              required: ["subject", "body"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_booking" },
        messages: [{ role: "user", content: `Draft a logistics booking request for this shipment:\n${facts}` }],
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
    console.error("draftBookingRequest_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

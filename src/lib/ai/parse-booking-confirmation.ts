import Anthropic from "@anthropic-ai/sdk";

// Parse a transporter's reply to an inland-booking request into a structured
// confirmation. Extracts ONLY what the transporter explicitly states — never
// invents a date, container or cost. Returns null on failure. Advisory only:
// the operator reads it, Qra books nothing.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ParsedBookingConfirmation = {
  confirmed: boolean;
  pickupDate: string;
  containerDetails: string;
  cost: string;
  notes: string;
};

const SYSTEM_PROMPT = `You read a transporter's reply to an inland booking request for an Indian export shipment. Pull ONLY what the transporter explicitly states. Set confirmed=true only if they clearly accept or confirm the booking; otherwise false. If a field is not stated, leave it empty — NEVER guess or invent a date, container or cost. Keep values short and as stated. Put anything the operator must act on (cut-offs, requirements, documents needed) in notes.`;

export async function parseBookingConfirmation(rawText: string): Promise<ParsedBookingConfirmation | null> {
  if (!rawText.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_confirmation",
            description: "Record what the transporter stated in their booking reply.",
            input_schema: {
              type: "object",
              properties: {
                confirmed: { type: "boolean", description: "true only if the transporter clearly accepts/confirms the booking" },
                pickup_date: { type: "string", description: "pickup date as stated, or empty" },
                container_details: { type: "string", description: "container / equipment details as stated, or empty" },
                cost: { type: "string", description: "cost with currency as stated, or empty" },
                notes: { type: "string", description: "anything the operator must act on (cut-offs, requirements), or empty" },
              },
              required: ["confirmed", "pickup_date", "container_details", "cost", "notes"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_confirmation" },
        messages: [{ role: "user", content: rawText.slice(0, 4000) }],
      },
      { timeout: 30_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const o = (toolUse?.input ?? {}) as Record<string, unknown>;
    return {
      confirmed: o.confirmed === true,
      pickupDate: String(o.pickup_date ?? "").trim().slice(0, 120),
      containerDetails: String(o.container_details ?? "").trim().slice(0, 200),
      cost: String(o.cost ?? "").trim().slice(0, 120),
      notes: String(o.notes ?? "").trim().slice(0, 500),
    };
  } catch (e) {
    console.error("parseBookingConfirmation_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

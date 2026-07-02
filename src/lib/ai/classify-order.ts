import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cheap gate: decide whether a plain-text WhatsApp message is a new export
// order (so we should create a shipment and extract from it) versus chit-chat,
// a question, or a greeting. Keeps Sonnet extraction off non-order messages.
export async function isOrderMessage(text: string): Promise<boolean> {
  const trimmed = text.trim();
  // Obvious non-orders: too short to carry an order.
  if (trimmed.length < 15) return false;

  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 80,
        system:
          "You decide if a WhatsApp message from an exporter is a NEW export order/purchase instruction to act on (it names goods to ship plus at least a quantity or a buyer/destination), versus a greeting, question, status check, or chit-chat. Be conservative: only say it is an order when there is a concrete product and at least one of quantity, buyer, or destination.",
        tools: [
          {
            name: "classify",
            description: "Record whether the message is a new export order.",
            input_schema: {
              type: "object",
              properties: { is_order: { type: "boolean" } },
              required: ["is_order"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "classify" },
        messages: [{ role: "user", content: trimmed.slice(0, 1500) }],
      },
      { timeout: 30_000 }
    );

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const input = (toolUse?.input ?? {}) as { is_order?: unknown };
    return input.is_order === true;
  } catch (err) {
    // On any classification failure, treat as NOT an order — fall through to
    // normal chat rather than creating a spurious shipment.
    console.error("order_classify_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}

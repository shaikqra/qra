import Anthropic from "@anthropic-ai/sdk";

// Advisory HS-code check. Given the goods and the HS code currently on the
// shipment, judges whether they plausibly match and suggests the most
// appropriate code. ADVISORY only — the licensed broker (and, later, the Trade
// Graph) is the authority. Never files or decides on its own.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type HsResult = { current: string; suggested: string; matches: boolean; note: string };

const SYSTEM_PROMPT = `You classify HS codes for Indian exports. Given a product description and the HS code currently on the shipment, judge whether that code plausibly matches the goods, and give the most appropriate HS code. India files on the 8-digit ITC-HS tariff, so ALWAYS return the full 8-digit Indian ITC-HS code (never a 6-digit international heading). You are ADVISORY — the licensed customs broker is the authority. Be conservative: if the current code already plausibly fits, say it matches.`;

export async function classifyHsCode(product: string, currentHs: string): Promise<HsResult | null> {
  if (!product.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_hs",
            description: "Record the HS-code assessment.",
            input_schema: {
              type: "object",
              properties: {
                suggested: { type: "string", description: "the full 8-digit Indian ITC-HS code, digits and dots only" },
                matches: { type: "boolean", description: "does the current code plausibly match the product" },
                note: { type: "string", description: "one short line of reasoning" },
              },
              required: ["suggested", "matches", "note"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_hs" },
        messages: [
          {
            role: "user",
            content: `Product: ${product.slice(0, 300)}\nCurrent HS code: ${currentHs || "(none on the shipment)"}`,
          },
        ],
      },
      { timeout: 30_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const o = (toolUse?.input ?? {}) as { suggested?: unknown; matches?: unknown; note?: unknown };
    const suggested = String(o.suggested ?? "").trim().slice(0, 20);
    if (!suggested) return null;
    return { current: currentHs, suggested, matches: o.matches === true, note: String(o.note ?? "").slice(0, 200) };
  } catch (e) {
    console.error("classifyHsCode_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

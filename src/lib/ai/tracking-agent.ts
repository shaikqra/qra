import Anthropic from "@anthropic-ai/sdk";

// Qra's Tracking agent (watchtower). First capability: read a carrier status /
// tracking update into a clean milestone + ETA, and — given the awarded carrier's
// free days — flag demurrage/detention risk. Read-only and ADVISORY: it raises a
// note, takes no action, and never invents a date or a status it wasn't given.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ShipmentStatus = {
  vessel: string;
  milestone: string;
  eta: string;
  summary: string;
  riskNote: string;
};

const SYSTEM_PROMPT = `You are Qra's Tracking agent for Indian exporters. Read the carrier's status / tracking update for an export shipment and extract: the vessel/voyage, the latest milestone (e.g. "departed Chennai", "at sea", "arrived Newark"), and the ETA exactly as stated.

Then write a one-line plain-English status summary.

If a "free days at destination" figure is provided AND the update suggests the container has arrived or will soon, and the time at port looks likely to exceed the free days, write a short demurrage-risk note (otherwise leave the risk note empty). Demurrage at Indian/major ports runs roughly USD 400+/day per container, escalating — so flag it plainly.

Rules: use ONLY what the update states. NEVER invent a vessel, date, milestone or ETA. If a field isn't stated, leave it empty. ADVISORY only — you track and warn, you take no action.`;

export async function assessShipmentStatus(
  rawText: string,
  freeDaysNote: string
): Promise<ShipmentStatus | null> {
  if (!rawText.trim()) return null;
  try {
    const message = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_status",
            description: "Record the shipment status read from the update.",
            input_schema: {
              type: "object",
              properties: {
                vessel: { type: "string", description: "vessel / voyage, or empty" },
                milestone: { type: "string", description: "latest milestone, or empty" },
                eta: { type: "string", description: "ETA as stated, or empty" },
                summary: { type: "string", description: "one-line plain-English status" },
                risk_note: { type: "string", description: "demurrage/delay risk note, or empty if none" },
              },
              required: ["vessel", "milestone", "eta", "summary", "risk_note"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_status" },
        messages: [
          {
            role: "user",
            content: `${freeDaysNote ? freeDaysNote + "\n\n" : ""}Carrier update:\n${rawText.slice(0, 4000)}`,
          },
        ],
      },
      { timeout: 30_000 }
    );
    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const o = (toolUse?.input ?? {}) as Record<string, unknown>;
    const summary = String(o.summary ?? "").trim().slice(0, 300);
    if (!summary) return null;
    return {
      vessel: String(o.vessel ?? "").trim().slice(0, 120),
      milestone: String(o.milestone ?? "").trim().slice(0, 160),
      eta: String(o.eta ?? "").trim().slice(0, 120),
      summary,
      riskNote: String(o.risk_note ?? "").trim().slice(0, 300),
    };
  } catch (e) {
    console.error("assessShipmentStatus_failed", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

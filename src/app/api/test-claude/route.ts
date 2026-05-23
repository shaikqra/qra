 import Anthropic from "@anthropic-ai/sdk";

  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  export async function GET() {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
    }

    try {
      const result = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: "Reply in one short sentence: are you Claude Haiku 4.5, and is the Qra API working?",
          },
        ],
      });

      const reply = result.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      return Response.json({
        ok: true,
        model: result.model,
        reply,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      });
    } catch (err) {
      console.error("claude_test_failed", {
        name: err instanceof Error ? err.name : "unknown",
        status: err instanceof Anthropic.APIError ? err.status : undefined,
      });
      return Response.json({ ok: false, error: "Claude call failed" }, { status: 500 });
    }
  }

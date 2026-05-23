 import { NextRequest } from "next/server";
  import Anthropic from "@anthropic-ai/sdk";
  import twilio from "twilio";

  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const SYSTEM_PROMPT = `You are Qra, a helpful AI assistant for Indian exporters. Respond briefly and
  helpfully in 1-3 sentences.`;

  const MAX_INPUT_LENGTH = 1000;
  const RATE_LIMIT_MAX = 10;
  const RATE_LIMIT_WINDOW_MS = 60_000;

  const rateLimitBuckets = new Map<string, number[]>();

  function isRateLimited(sender: string): boolean {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const timestamps = (rateLimitBuckets.get(sender) ?? []).filter((t) => t > cutoff);
    if (timestamps.length >= RATE_LIMIT_MAX) {
      rateLimitBuckets.set(sender, timestamps);
      return true;
    }
    timestamps.push(now);
    rateLimitBuckets.set(sender, timestamps);
    return false;
  }

  function twimlResponse(message: string): Response {
    const escaped = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  export async function POST(req: NextRequest) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const webhookUrl = process.env.TWILIO_WEBHOOK_URL;

    if (!authToken || !webhookUrl) {
      return new Response("Server misconfigured", { status: 500 });
    }

    const signature = req.headers.get("x-twilio-signature") ?? "";
    const rawBody = await req.text();
    const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

    const valid = twilio.validateRequest(authToken, signature, webhookUrl, params);
    if (!valid) {
      return new Response("Unauthorized", { status: 401 });
    }

    const from = params.From ?? "";
    const body = (params.Body ?? "").trim();

    if (!from || !body) {
      return twimlResponse("Sorry, I couldn't read your message. Please try again.");
    }

    if (body.length > MAX_INPUT_LENGTH) {
      return twimlResponse(`Your message is too long. Please keep it under ${MAX_INPUT_LENGTH} characters.`);
    }

    if (isRateLimited(from)) {
      return twimlResponse("You're sending messages too fast. Please wait a minute and try again.");
    }

    try {
      const result = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: body }],
      });

      const reply = result.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!reply) {
        return twimlResponse("Sorry, I couldn't generate a reply. Please try again.");
      }

      return twimlResponse(reply);
    } catch (err) {
      console.error("whatsapp_webhook_failed", {
        name: err instanceof Error ? err.name : "unknown",
        status: err instanceof Anthropic.APIError ? err.status : undefined,
      });
      return twimlResponse("Sorry, I'm having trouble right now. Please try again in a moment.");
    }
  }
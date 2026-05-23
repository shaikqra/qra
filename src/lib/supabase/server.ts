import { createClient } from "@supabase/supabase-js";

  export function createSupabaseServerClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Supabase env vars not configured");
    }
    return createClient(url, key, {
      auth: { persistSession: false },
    });
  }

  What it does: server-only Supabase client using the service role key (bypasses RLS). Never import this from
  a client component.

  File 2: src/lib/hash.ts

  import { createHash } from "crypto";

  export function hashPhone(phone: string): string {
    return createHash("sha256").update(phone).digest("hex");
  }

  What it does: SHA-256 hash of a phone number. Same input → same hash, so we can look up returning customers
  without storing raw phone numbers (PII discipline).

  File 3: src/app/api/health/route.ts

  import { createSupabaseServerClient } from "@/lib/supabase/server";

  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  type Health = "ok" | "down";

  export async function GET() {
    const checks: { db: Health; anthropic: Health; twilio: Health } = {
      db: "down",
      anthropic: "down",
      twilio: "down",
    };

    try {
      const supabase = createSupabaseServerClient();
      const { error } = await supabase.from("customers").select("id").limit(1);
      checks.db = error ? "down" : "ok";
    } catch {
      checks.db = "down";
    }

    checks.anthropic = process.env.ANTHROPIC_API_KEY ? "ok" : "down";

    checks.twilio =
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WEBHOOK_URL
        ? "ok"
        : "down";

    const allOk = Object.values(checks).every((v) => v === "ok");
    return Response.json(checks, { status: allOk ? 200 : 503 });
  }

  What it does: returns JSON with three subsystem statuses. DB does a tiny SELECT to verify connectivity.
  Anthropic + Twilio just verify env vars exist (we don't burn API tokens on health checks). Returns 200 if
  all ok, 503 otherwise.

  Save all 3 files (Ctrl+S on each).

  Step 4 — Replace the WhatsApp webhook (entire file)

  Open src/app/api/whatsapp/webhook/route.ts.

  Ctrl+A → delete everything → paste this:

  import { NextRequest } from "next/server";
  import Anthropic from "@anthropic-ai/sdk";
  import twilio from "twilio";
  import { createSupabaseServerClient } from "@/lib/supabase/server";
  import { hashPhone } from "@/lib/hash";

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

  async function lookupOrCreateCustomer(phoneHash: string): Promise<void> {
    try {
      const supabase = createSupabaseServerClient();
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("phone_hash", phoneHash)
        .maybeSingle();

      if (existing) return;

      await supabase.from("customers").insert({ phone_hash: phoneHash });
    } catch (err) {
      console.error("customer_lookup_failed", {
        name: err instanceof Error ? err.name : "unknown",
      });
    }
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

    void lookupOrCreateCustomer(hashPhone(from));

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
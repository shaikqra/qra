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
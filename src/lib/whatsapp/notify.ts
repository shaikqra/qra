import twilio from "twilio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Best-effort WhatsApp text to a customer. Never throws — a failed send logs
// (no PII) and returns false so callers can record/surface the miss. The single
// place we talk to Twilio for outbound notifications.
export async function notifyCustomerWhatsApp(
  admin: ReturnType<typeof createSupabaseServerClient>,
  customerId: string,
  text: string
): Promise<boolean> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER?.trim();
    if (!sid || !token || !fromNumber) return false;

    const { data: customer } = await admin
      .from("customers")
      .select("whatsapp_number")
      .eq("id", customerId)
      .maybeSingle();
    const to = (customer?.whatsapp_number ?? "").trim();
    if (!to) return false;

    await twilio(sid, token).messages.create({ from: fromNumber, to, body: text });
    return true;
  } catch (err) {
    console.error("whatsapp_notify_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}

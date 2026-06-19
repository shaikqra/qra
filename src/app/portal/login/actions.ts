"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreatePortalToken, portalUrlFor } from "@/lib/portal/auth";
import { notifyCustomerWhatsApp } from "@/lib/whatsapp/notify";

type Result = { ok: boolean; message: string };

// Identical wording whether or not the number is registered, so this can never be
// used to discover who is (or isn't) a Qra customer.
const SENT =
  "If that number is registered with Qra, we've sent your secure console link to it on WhatsApp. Open WhatsApp to continue.";

// Best-effort per-IP / per-number throttle (in-memory, per instance). Caps a flood
// of link requests (WhatsApp cost) and slows enumeration. The 192-bit portal token
// is the real security boundary.
const WINDOW_MS = 60_000;
const MAX = 5;
const buckets = new Map<string, number[]>();
function throttled(key: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (hits.length >= MAX) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

// Look up the exporter by their WhatsApp number and send their portal link to that
// number. Never reveals whether the number exists, never shows the link on screen,
// never logs the number or any PII.
export async function requestPortalLink(rawNumber: string): Promise<Result> {
  const digits = (rawNumber ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return {
      ok: false,
      message: "Enter your WhatsApp number with country code, e.g. +91 81234 56789.",
    };
  }

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (throttled(`ip:${ip}`) || throttled(`num:${digits}`)) {
    return { ok: true, message: SENT }; // generic even when throttled
  }

  try {
    const admin = createSupabaseServerClient();
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("whatsapp_number", `whatsapp:+${digits}`)
      .maybeSingle();
    if (customer?.id) {
      const token = await getOrCreatePortalToken(customer.id);
      if (token) {
        await notifyCustomerWhatsApp(
          admin,
          customer.id,
          `Here's your secure Qra console link:\n${portalUrlFor(token)}\n\nIt opens your shipments and documents. Keep it private — anyone with this link can view them.`
        );
      }
    }
  } catch (err) {
    console.error("portal_link_request_failed", { name: err instanceof Error ? err.name : "unknown" });
  }

  return { ok: true, message: SENT };
}

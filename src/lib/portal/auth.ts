import { randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The exporter's private portal lives at /portal/<portal_token>. The token IS
// the credential — a secret, capability-style link (like a Google "anyone with
// the link" share). So it's long (192-bit), never shown publicly, and the only
// thing it grants is READ access to that one customer's own shipments + docs.
const PORTAL_TOKEN_BYTES = 24; // 192-bit -> 48 lowercase hex chars
const PORTAL_BASE_URL = "https://theqra.com";

export type PortalCustomer = { id: string; display_name: string | null };

export function portalUrlFor(token: string): string {
  return `${PORTAL_BASE_URL}/portal/${token}`;
}

// Generate (once) and return the exporter's portal token. Mirrors the inbound
// token pattern: a concurrent create can't double-set thanks to the `is null`
// guard, and we re-read on conflict.
export async function getOrCreatePortalToken(customerId: string): Promise<string | null> {
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("customers")
    .select("portal_token")
    .eq("id", customerId)
    .maybeSingle();
  if (data?.portal_token) return data.portal_token as string;

  const token = randomBytes(PORTAL_TOKEN_BYTES).toString("hex");
  const { error } = await admin
    .from("customers")
    .update({ portal_token: token })
    .eq("id", customerId)
    .is("portal_token", null);
  if (error) {
    console.error("portal_token_set_failed", { code: error.code });
    const { data: again } = await admin
      .from("customers")
      .select("portal_token")
      .eq("id", customerId)
      .maybeSingle();
    return (again?.portal_token as string) ?? null;
  }
  return token;
}

// Resolve the customer behind a portal token. Rejects malformed tokens before
// touching the DB. Returns only the id + display name — never more.
export async function resolveCustomerByPortalToken(token: string): Promise<PortalCustomer | null> {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("customers")
    .select("id, display_name")
    .eq("portal_token", token)
    .maybeSingle();
  return (data as PortalCustomer | null) ?? null;
}

// Light per-IP throttle on the public portal (defence in depth — the 192-bit
// token already makes brute force infeasible). In-memory, per server instance.
const RATE_MAX = 40;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();

export function portalRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (buckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    buckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  buckets.set(ip, hits);
  return false;
}

// Tighter, SEPARATE throttle for write actions (confirm/approve). Capped harder
// because a confirm triggers paid pipeline work, and on its own bucket so a
// write flood can't also lock the exporter out of just viewing pages. The atomic
// DB status claims are the real double-run guard; this is cost hygiene.
const WRITE_RATE_MAX = 8;
const writeBuckets = new Map<string, number[]>();

export function portalWriteRateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (writeBuckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= WRITE_RATE_MAX) {
    writeBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  writeBuckets.set(key, hits);
  return false;
}

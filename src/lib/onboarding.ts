import { createHash, randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ExporterProfileInput } from "@/lib/profile-fields";
import { ALL_PROFILE_FIELDS } from "@/lib/profile-fields";

// Profile-onboarding invites. The raw token lives only in the link we hand
// out; the database stores its SHA-256 hash. Single use, 7-day expiry.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_URL = "https://theqra.com";

// Best-effort per-IP rate limit for the public onboarding surface (the token
// is the real security; this just keeps probing from running up DB usage).
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();

export function onboardingRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (rateBuckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    rateBuckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(ip, hits);
  return false;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvite(
  customerId: string
): Promise<{ url: string } | { error: string }> {
  const admin = createSupabaseServerClient();
  const token = randomBytes(32).toString("base64url");

  const { error } = await admin.from("profile_invites").insert({
    customer_id: customerId,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("invite_create_failed", { code: error.code });
    return { error: "Could not create the invite" };
  }
  return { url: `${SITE_URL}/onboard/${token}` };
}

// Look up a live (unused, unexpired) invite. Returns the customer it belongs to.
export async function validateInvite(
  token: string
): Promise<{ customerId: string; inviteId: string } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("profile_invites")
    .select("id, customer_id, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data) return null;
  if (data.used_at) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return { customerId: data.customer_id as string, inviteId: data.id as string };
}

// Save the customer's submitted profile and burn the invite. The atomic
// used_at claim makes a double-submit harmless.
export async function submitInviteProfile(
  token: string,
  input: ExporterProfileInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const invite = await validateInvite(token);
  if (!invite) return { ok: false, error: "This link is no longer valid. Ask for a new one." };

  const admin = createSupabaseServerClient();

  // Whitelist + trim + cap every field; ignore anything not in the schema.
  const cleaned: Record<string, string> = {};
  for (const f of ALL_PROFILE_FIELDS) {
    const v = (input[f.key] ?? "").toString().trim();
    cleaned[f.key] = v.slice(0, f.area ? 2000 : 300);
  }

  // Burn the invite first (atomic claim) so the same link can't write twice.
  const { data: claimed } = await admin
    .from("profile_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.inviteId)
    .is("used_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: "This link was already used. Ask for a new one." };
  }

  const { data: existing } = await admin
    .from("exporter_profiles")
    .select("id")
    .eq("customer_id", invite.customerId)
    .maybeSingle();

  const { error } = existing
    ? await admin
        .from("exporter_profiles")
        .update({ ...cleaned, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await admin
        .from("exporter_profiles")
        .insert({ ...cleaned, customer_id: invite.customerId, is_default: false });
  if (error) {
    console.error("invite_profile_save_failed", { code: error.code });
    // Un-burn the invite so a transient failure doesn't destroy the link and
    // the customer's 10 minutes of typing — they can simply retry.
    await admin
      .from("profile_invites")
      .update({ used_at: null })
      .eq("id", invite.inviteId);
    return { ok: false, error: "Could not save — please try again." };
  }

  // Use the legal name as the customer's display name if none is set yet.
  if (cleaned.legal_name) {
    await admin
      .from("customers")
      .update({ display_name: cleaned.legal_name })
      .eq("id", invite.customerId)
      .is("display_name", null);
  }

  // The burned invite row (used_at) is itself the audit record of the
  // self-onboarding — audit_operator_action requires a shipment, which an
  // onboarding doesn't have.
  return { ok: true };
}

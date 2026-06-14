"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAuthClient, getOperatorSession } from "@/lib/supabase/auth";
import { refreshAllLists, type RefreshResult } from "@/lib/screening/local-lists";
import { createInvite } from "@/lib/onboarding";
import { setAppSetting } from "@/lib/app-settings";
import { writeChaContacts } from "@/lib/cha-contacts";
import type { ChaContactInput } from "@/lib/profile-fields";

// Operator: turn automatic CHA emailing on/off (default off = pilot mode).
export async function setAutoSendCha(
  enabled: boolean
): Promise<{ ok: boolean }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false };
  const ok = await setAppSetting("auto_send_cha", enabled ? "true" : "false");
  revalidatePath("/internal/settings");
  return { ok };
}

// Operator: create a one-time onboarding link a customer fills their own
// profile through. The operator copies the link and sends it to them.
export async function inviteCustomerToOnboard(
  customerId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  const result = await createInvite(customerId);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, url: result.url };
}

// Operator-triggered refresh of the locally-ingested denied-party lists (UN, EU).
export async function refreshSanctionsLists(): Promise<
  { ok: true; results: RefreshResult[] } | { ok: false; error: string }
> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };
  try {
    const results = await refreshAllLists();
    return { ok: true, results };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("refreshSanctionsLists failed:", msg);
    return { ok: false, error: "Could not refresh the lists — try again in a moment." };
  }
}

export type { ExporterProfileInput } from "@/lib/profile-fields";
import type { ExporterProfileInput } from "@/lib/profile-fields";

type Result = { ok: true } | { ok: false; error: string };

// customerId null = the default/fallback profile. Otherwise the profile is
// saved for that exporter, and customerName updates their display name.
export async function saveExporterProfile(
  input: ExporterProfileInput,
  customerId: string | null,
  customerName?: string,
  chas?: ChaContactInput[]
): Promise<Result> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };

  const supabase = await createSupabaseAuthClient();

  const trimmed: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) trimmed[k] = (v ?? "").trim();

  if (customerId) {
    const name = (customerName ?? "").trim();
    if (name) {
      await supabase
        .from("customers")
        .update({ display_name: name })
        .eq("id", customerId);
    }

    const { data: existing } = await supabase
      .from("exporter_profiles")
      .select("id")
      .eq("customer_id", customerId)
      .maybeSingle();

    const { error } = existing
      ? await supabase
          .from("exporter_profiles")
          .update({ ...trimmed, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase
          .from("exporter_profiles")
          // is_default false: the partial unique index allows only one default row.
          .insert({ ...trimmed, customer_id: customerId, is_default: false });

    if (error) return { ok: false, error: "Could not save the profile" };

    // CHAs are per-customer; replace the list for this exporter. The write is
    // atomic, so on failure the existing broker list is left untouched.
    const chaWrite = await writeChaContacts(supabase, customerId, chas ?? []);
    if (!chaWrite.ok) {
      return {
        ok: false,
        error: "Saved the profile, but couldn't update the brokers — your existing brokers are unchanged. Try saving again.",
      };
    }

    revalidatePath("/internal/settings");
    return { ok: true };
  }

  const { data: existing } = await supabase
    .from("exporter_profiles")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("exporter_profiles")
        .update({ ...trimmed, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase
        .from("exporter_profiles")
        .insert({ ...trimmed, is_default: true });

  if (error) return { ok: false, error: "Could not save the profile" };

  revalidatePath("/internal/settings");
  return { ok: true };
}

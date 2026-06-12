import { createSupabaseServerClient } from "@/lib/supabase/server";

// Operator-tunable policy flags, stored as key/value via the service role.

export async function getAppSetting(key: string): Promise<string | null> {
  const admin = createSupabaseServerClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<boolean> {
  const admin = createSupabaseServerClient();
  const { error } = await admin
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  return !error;
}

// Whether documents auto-email to the CHA on customer approval. Default OFF
// (pilot mode: the operator reviews and sends) until explicitly enabled.
export async function isAutoSendChaEnabled(): Promise<boolean> {
  return (await getAppSetting("auto_send_cha")) === "true";
}

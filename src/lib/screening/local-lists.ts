import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchUnList, normalizeName } from "./un-list";

// Lists we ingest and match locally (UN now; EU/DGFT later). A configured
// provider is only "loaded" if a successful refresh marker exists AND it isn't
// stale; otherwise it counts as UNCHECKED and the caller fails closed.
const CONFIGURED_PROVIDERS = ["UN"];
const MAX_LIST_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LocalMatch = {
  provider: string;
  entry_type: string;
  full_name: string;
  score: number;
};

// Replace the stored UN list with a freshly fetched copy. The fetch (with its
// sanity floor) runs BEFORE we touch the table, so a bad fetch can't wipe the
// current list. The completion marker is written LAST, so a mid-insert failure
// leaves the provider markerless → unchecked → fail closed.
export async function ingestUnList(): Promise<{ count: number }> {
  const admin = createSupabaseServerClient();
  const entries = await fetchUnList();

  const rows = entries.map((e) => ({
    provider: "UN",
    entry_type: e.entryType,
    full_name: e.fullName.slice(0, 500),
    normalized_name: normalizeName(e.fullName).slice(0, 500),
  }));

  // Clear the marker first: during refresh the provider reads as unloaded.
  await admin.from("sanctions_list_refresh").delete().eq("provider", "UN");
  await admin.from("sanctions_list_entries").delete().eq("provider", "UN");

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("sanctions_list_entries")
      .insert(rows.slice(i, i + 500));
    if (error) throw new Error(`UN ingest insert failed: ${error.message}`);
  }

  const { error: markErr } = await admin.from("sanctions_list_refresh").insert({
    provider: "UN",
    completed_at: new Date().toISOString(),
    row_count: rows.length,
  });
  if (markErr) throw new Error(`UN ingest marker failed: ${markErr.message}`);
  return { count: rows.length };
}

// Per-provider load status (for fail-closed checks and audit disclosure).
async function providerStatus(
  admin: ReturnType<typeof createSupabaseServerClient>
): Promise<Record<string, { loaded: boolean; completed_at: string | null }>> {
  const status: Record<string, { loaded: boolean; completed_at: string | null }> = {};
  for (const provider of CONFIGURED_PROVIDERS) {
    const { data } = await admin
      .from("sanctions_list_refresh")
      .select("completed_at")
      .eq("provider", provider)
      .maybeSingle();
    const completedAt = (data?.completed_at as string | undefined) ?? null;
    const fresh =
      !!completedAt && Date.now() - new Date(completedAt).getTime() <= MAX_LIST_AGE_MS;
    status[provider] = { loaded: fresh, completed_at: completedAt };
  }
  return status;
}

// Disclosure helper: which local lists are currently usable, and how old.
export async function localListStatus(): Promise<
  Record<string, { loaded: boolean; completed_at: string | null }>
> {
  return providerStatus(createSupabaseServerClient());
}

// Screen a name against all loaded local lists. Returns matches and any
// configured provider that had no data (so the caller fails closed).
export async function screenLocalName(
  name: string
): Promise<{ matches: LocalMatch[]; uncheckedProviders: string[] }> {
  const admin = createSupabaseServerClient();
  const norm = normalizeName(name);
  if (!norm) return { matches: [], uncheckedProviders: [...CONFIGURED_PROVIDERS] };

  // A provider is unchecked unless it has a fresh completion marker.
  const status = await providerStatus(admin);
  const unchecked = CONFIGURED_PROVIDERS.filter((p) => !status[p]?.loaded);

  const { data, error } = await admin.rpc("match_sanctions", { query_name: norm });
  if (error) {
    console.error("local_sanctions_match_failed", { code: error.code });
    // Matching failed — treat every configured provider as unchecked.
    return { matches: [], uncheckedProviders: [...CONFIGURED_PROVIDERS] };
  }
  return { matches: (data ?? []) as LocalMatch[], uncheckedProviders: unchecked };
}

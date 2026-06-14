import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChaContactInput } from "@/lib/profile-fields";

// One exporter can have several customs brokers (a different CHA per port, say).
// This module owns reading/writing that list. The raw CHA columns on
// exporter_profiles are superseded by the cha_contacts table.

const MAX_CHAS = 15;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type CleanCha = { name: string; email: string; port: string; is_default: boolean };

export function isValidChaEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

// Trim, cap, drop nameless rows, and guarantee exactly one default.
export function cleanChaList(raw: ChaContactInput[] | undefined): CleanCha[] {
  const rows: CleanCha[] = (raw ?? [])
    .map((c) => {
      const email = (c?.email ?? "").toString().trim().slice(0, 200);
      return {
        name: (c?.name ?? "").toString().trim().slice(0, 200),
        // Drop a malformed address rather than store one that will bounce later;
        // an empty email just means "no automatic send to this broker".
        email: email && isValidChaEmail(email) ? email : "",
        port: (c?.port ?? "").toString().trim().slice(0, 100),
        is_default: !!c?.is_default,
      };
    })
    .filter((c) => c.name !== "")
    .slice(0, MAX_CHAS);

  // Exactly one default: keep the first flagged row, else default the first row.
  let chosen = rows.findIndex((c) => c.is_default);
  if (chosen === -1 && rows.length > 0) chosen = 0;
  rows.forEach((c, i) => (c.is_default = i === chosen));
  return rows;
}

// Replace a customer's whole CHA list. Done in a single transaction via the
// replace_cha_contacts RPC (delete + insert) so a failed write never leaves the
// exporter with an empty broker list — on error the old list is preserved. The
// caller has already authorized this; pass the right client — the service-role
// client for the public onboarding path, the RLS auth client for the operator
// path. customer_id is fixed by the caller, never taken from the row data.
export async function writeChaContacts(
  client: SupabaseClient,
  customerId: string,
  raw: ChaContactInput[] | undefined
): Promise<{ ok: boolean }> {
  const rows = cleanChaList(raw);
  const { error } = await client.rpc("replace_cha_contacts", {
    p_customer_id: customerId,
    p_rows: rows,
  });
  if (error) {
    console.error("cha_contacts_write_failed", { code: error.code });
    return { ok: false };
  }
  return { ok: true };
}

// A customer's CHAs, default first, for prefilling the operator form.
export async function listChaContacts(
  client: SupabaseClient,
  customerId: string
): Promise<ChaContactInput[]> {
  const { data } = await client
    .from("cha_contacts")
    .select("name, email, port, is_default")
    .eq("customer_id", customerId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    name: (r.name as string) ?? "",
    email: (r.email as string) ?? "",
    port: (r.port as string) ?? "",
    is_default: !!r.is_default,
  }));
}

// The CHA email to send a shipment's documents to: the default broker, or the
// first one that has an email. Returns "" when the exporter has no CHA set.
export async function resolveChaEmail(
  client: SupabaseClient,
  customerId: string
): Promise<string> {
  const { data } = await client
    .from("cha_contacts")
    .select("email, is_default, created_at")
    .eq("customer_id", customerId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  for (const row of (data ?? []) as { email: string | null }[]) {
    const email = (row.email ?? "").trim();
    if (email) return email;
  }
  return "";
}

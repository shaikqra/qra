"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAuthClient, getOperatorSession } from "@/lib/supabase/auth";

export type ExporterProfileInput = {
  legal_name: string;
  address: string;
  factory_address: string;
  cin: string;
  gstin: string;
  iec: string;
  organic_code: string;
  bank_name: string;
  bank_branch: string;
  bank_swift: string;
  bank_account: string;
  bank_beneficiary: string;
  declaration_lut: string;
  declaration_rodtep: string;
  declaration_origin: string;
  default_currency: string;
  default_incoterm: string;
};

type Result = { ok: true } | { ok: false; error: string };

export async function saveExporterProfile(input: ExporterProfileInput): Promise<Result> {
  const session = await getOperatorSession();
  if (!session) return { ok: false, error: "Not authorized" };

  const supabase = await createSupabaseAuthClient();

  const trimmed: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) trimmed[k] = (v ?? "").trim();

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

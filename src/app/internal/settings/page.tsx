import Link from "next/link";
import { ensureOperator } from "../layout";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { ProfileForm } from "./profile-form";
import type { ExporterProfileInput } from "./actions";

export default async function SettingsPage() {
  await ensureOperator();
  const supabase = await createSupabaseAuthClient();

  const { data } = await supabase
    .from("exporter_profiles")
    .select(
      "legal_name, address, factory_address, cin, gstin, iec, organic_code, bank_name, bank_branch, bank_swift, bank_account, bank_beneficiary, declaration_lut, declaration_rodtep, declaration_origin, default_currency, default_incoterm"
    )
    .eq("is_default", true)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/internal/shipments" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← All shipments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Exporter profile</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
          This is the static information that appears on every invoice — identity, bank details,
          and your standard declarations. Fill it once; documents pull from it automatically.
        </p>
      </div>

      <ProfileForm initial={(data as Partial<ExporterProfileInput> | null) ?? null} />
    </div>
  );
}

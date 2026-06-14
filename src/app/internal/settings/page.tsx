import Link from "next/link";
import { ensureOperator } from "../layout";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";
import { ProfileForm } from "./profile-form";
import { SanctionsRefresh } from "./sanctions-refresh";
import { InviteButton } from "./invite-button";
import { AutoChaToggle } from "./auto-cha-toggle";
import { isAutoSendChaEnabled } from "@/lib/app-settings";
import { listChaContacts } from "@/lib/cha-contacts";
import type { ExporterProfileInput } from "./actions";

// The sanctions-list refresh fetches and parses large government files; give
// the server action room to finish.
export const maxDuration = 60;

const PROFILE_COLUMNS =
  "legal_name, address, factory_address, cin, gstin, iec, organic_code, bank_name, bank_branch, bank_swift, bank_account, bank_beneficiary, declaration_lut, declaration_rodtep, declaration_origin, default_currency, default_incoterm";

type CustomerRow = {
  id: string;
  display_name: string | null;
  whatsapp_number: string | null;
};

function customerLabel(c: CustomerRow): string {
  if (c.display_name) return c.display_name;
  if (c.whatsapp_number) return c.whatsapp_number.replace(/^whatsapp:/, "");
  return `${c.id.slice(0, 8)}…`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await ensureOperator();
  const { customer: selectedId } = await searchParams;
  const supabase = await createSupabaseAuthClient();

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, display_name, whatsapp_number");
  const customers = (customerRows ?? []) as CustomerRow[];

  const selected = customers.find((c) => c.id === selectedId) ?? null;
  const autoChaEnabled = await isAutoSendChaEnabled();

  const profileQuery = supabase.from("exporter_profiles").select(PROFILE_COLUMNS);
  const { data } = selected
    ? await profileQuery.eq("customer_id", selected.id).maybeSingle()
    : await profileQuery.eq("is_default", true).maybeSingle();

  // CHAs are per-customer; the default profile has none.
  const initialChas = selected ? await listChaContacts(supabase, selected.id) : [];

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium border ${
      active
        ? "bg-zinc-900 text-white border-zinc-900"
        : "bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50"
    }`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/internal/shipments" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← All shipments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Exporter profiles</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
          Each exporter has their own profile — identity, bank details, declarations and CHA.
          Documents for their shipments pull from it automatically. The default profile is used
          for exporters that don&apos;t have their own yet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/internal/settings" className={pill(!selected)}>
          Default profile
        </Link>
        {customers.map((c) => (
          <Link
            key={c.id}
            href={`/internal/settings?customer=${c.id}`}
            className={pill(selected?.id === c.id)}
          >
            {customerLabel(c)}
          </Link>
        ))}
      </div>

      {selected && <InviteButton customerId={selected.id} />}

      <ProfileForm
        key={selected?.id ?? "default"}
        initial={(data as Partial<ExporterProfileInput> | null) ?? null}
        customerId={selected?.id ?? null}
        initialCustomerName={selected?.display_name ?? ""}
        initialChas={initialChas}
      />

      <AutoChaToggle initialEnabled={autoChaEnabled} />

      <SanctionsRefresh />
    </div>
  );
}

-- Migration 004 UP: Exporter Profile
-- Stores the exporter's static data (identity, bank, standard declarations)
-- that appears on every invoice. Operator-managed, RLS-protected (holds
-- sensitive bank + tax identifiers — never hardcode these in app code).
-- Apply by pasting into Supabase SQL Editor and clicking Run.

create table if not exists public.exporter_profiles (
  id uuid primary key default gen_random_uuid(),
  is_default boolean not null default true,

  -- Identity
  legal_name text,
  address text,
  factory_address text,
  cin text,
  gstin text,
  iec text,
  organic_code text,

  -- Bank (for the payment block on the invoice)
  bank_name text,
  bank_branch text,
  bank_swift text,
  bank_account text,
  bank_beneficiary text,

  -- Standard declarations (the exporter owns the exact legal wording)
  declaration_lut text,
  declaration_rodtep text,
  declaration_origin text,

  -- Defaults
  default_currency text,
  default_incoterm text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one default profile is expected in Year 1; enforce single default row.
create unique index if not exists exporter_profiles_one_default
  on public.exporter_profiles (is_default)
  where is_default = true;

alter table public.exporter_profiles enable row level security;
alter table public.exporter_profiles force row level security;

create policy exporter_profiles_operator_select on public.exporter_profiles
  for select using (public.is_operator());

create policy exporter_profiles_operator_insert on public.exporter_profiles
  for insert with check (public.is_operator());

create policy exporter_profiles_operator_update on public.exporter_profiles
  for update using (public.is_operator()) with check (public.is_operator());

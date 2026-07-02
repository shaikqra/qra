-- Migration 001 UP: the BASE SCHEMA — snapshot of the live database, 2026-07-02.
--
-- WHY THIS FILE EXISTS: the original base schema was created directly in the
-- Supabase dashboard before this repo's migration series began at 002, so the
-- 12 tables + 6 enums + 1 function below existed ONLY in the live project.
-- That meant (a) no disaster recovery — a lost project could not be rebuilt
-- from source, and (b) the "RLS on every customer-data table" guardrail was
-- unverifiable from source. This snapshot closes both gaps. It was captured
-- from information_schema / pg_catalog on 2026-07-02 (schema state after
-- migration 034) and cross-checked against the live constraint/index/policy/
-- trigger/RLS listings.
--
-- HOW TO USE IT:
--   * On the LIVE database: never needed — everything here already exists.
--     Every statement is guarded (IF NOT EXISTS / duplicate_object catch), so
--     an accidental run is a no-op, not damage.
--   * On a FRESH database (restore / staging): run this file FIRST, then run
--     migrations 002 → 034 in order. Later migrations' additive statements
--     (ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE ... IF NOT
--     EXISTS) no-op where this snapshot already includes their work.
--   * Policies for customers / shipments / audit_po_ingest are NOT created
--     here — migrations 002 / 010 / 016 own them (unguarded CREATE POLICY
--     would collide on replay). The other nine tables have NO policies by
--     design: RLS default-deny, service-role access only.
--   * The shipments updated_at trigger is owned by migration 029; the
--     generated_documents protect trigger by 003. Not duplicated here.

-- ---------------------------------------------------------------------------
-- extensions
-- ---------------------------------------------------------------------------
-- pgvector for methodology_entries.embedding (methodology library RAG).
-- pg_trgm is created by migration 011; gen_random_uuid() is core Postgres.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- enums (CREATE TYPE has no IF NOT EXISTS — catch duplicate_object instead)
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.source_channel as enum ('whatsapp', 'email', 'upload');
exception when duplicate_object then null; end $$;

-- Original Build-Bible lifecycle enum; superseded in app code by
-- shipment_status but still referenced by audit_status_update.
do $$ begin
  create type public.shipment_state as enum
    ('draft', 'extracted', 'screened', 'approved', 'sent', 'filed', 'cleared', 'rejected');
exception when duplicate_object then null; end $$;

-- Live value list as of 2026-07-02 — includes the values added by migrations
-- 008 / 019 / 023 / 028 (those use ADD VALUE IF NOT EXISTS, so replay no-ops).
do $$ begin
  create type public.shipment_status as enum (
    'po_received', 'data_extracting', 'awaiting_order_confirm',
    'awaiting_customer_info', 'awaiting_customer_verify',
    'generating_documents', 'sanctions_screening', 'bucket_b_review',
    'awaiting_customer_approval', 'awaiting_goods_ready', 'customer_approved',
    'filed_with_cha', 'customs_cleared', 'in_transit', 'delivered',
    'completed', 'rejected', 'order_declined'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_decision as enum ('approve', 'reject', 'change_requested');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.screen_decision as enum ('clear', 'flag', 'block');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.methodology_category as enum
    ('hs_code_rules', 'country_regulations', 'sector_specifics',
     'buyer_requirements', 'customs_quirks', 'cbam_factors');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- audit immutability (shared trigger function for the whole audit_* family)
-- ---------------------------------------------------------------------------
create or replace function public.audit_block_mutation()
 returns trigger
 language plpgsql
as $function$
  begin
    raise exception 'audit log rows are immutable (table=%, op=%)', tg_table_name, tg_op;
  end;
$function$;

-- ---------------------------------------------------------------------------
-- core tables (dependency order)
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  phone_hash text not null,
  display_name text,
  company_name text,
  status text not null default 'lead',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  country_pack_code text not null default 'IN',
  channel_partner_id uuid,
  whatsapp_number text,
  inbound_token text,
  portal_token text,
  constraint customers_phone_hash_key unique (phone_hash),
  constraint customers_phone_hash_check check (length(phone_hash) = 64),
  constraint customers_status_check
    check (status in ('lead', 'active', 'paused', 'churned')),
  constraint customers_country_pack_code_check
    check (country_pack_code in ('IN','BD','ID','VN','AE','EG','NG','KE','BR','MX'))
);

create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  name text not null,
  country char(2) not null,
  address text,
  vat_or_tax_id text,
  contact_email text,
  incoterms_default text,
  payment_terms_default text,
  preferred_currency char(3),
  cbam_exposed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint buyers_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete cascade
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  buyer_id uuid,
  reference_number text not null,
  customer_po_number text,
  status shipment_status not null default 'po_received',
  destination_country char(2),
  destination_port text,
  origin_port text,
  incoterms text,
  payment_terms text,
  currency char(3) not null default 'USD',
  total_value numeric(15,2),
  expected_ship_date date,
  actual_ship_date date,
  expected_delivery_date date,
  actual_delivery_date date,
  cbam_exposed boolean not null default false,
  llm_tokens_input integer default 0,
  llm_tokens_output integer default 0,
  llm_cost_inr numeric(10,4) default 0,
  bucket_b_minutes_spent integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  extracted_data jsonb not null default '{}'::jsonb,
  notes text,
  cha_reviewed_at timestamptz,
  cha_review_status text,
  cha_review_note text,
  inbound_email_id text,
  constraint shipments_reference_number_key unique (reference_number),
  constraint shipments_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete cascade,
  constraint shipments_buyer_id_fkey
    foreign key (buyer_id) references public.buyers(id),
  constraint shipments_cha_review_status_check
    check (cha_review_status in ('docs_approved', 'filed', 'changes_requested'))
);

create table if not exists public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null,
  product_description text not null,
  hs_code text,
  hs_code_confidence numeric(3,2),
  hs_code_verified_by_operator boolean default false,
  quantity numeric(15,4) not null,
  unit text,
  unit_price numeric(15,4),
  total_value numeric(15,2),
  weight_kg numeric(15,4),
  gross_weight_kg numeric(15,4),
  volume_cbm numeric(15,4),
  packages_count integer,
  packaging_description text,
  country_of_origin char(2) default 'IN',
  cbam_embedded_emissions_co2_kg numeric(15,4),
  cbam_emission_factor_source text,
  cbam_uses_default_value boolean default true,
  created_at timestamptz not null default now(),
  constraint shipment_items_shipment_id_fkey
    foreign key (shipment_id) references public.shipments(id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- the audit_* family (immutable, 7-year retention)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_po_ingest (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shipment_id uuid not null,
  storage_path text not null,
  file_sha256 text not null,
  source source_channel not null,
  source_ref text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint audit_po_ingest_file_sha256_check check (length(file_sha256) = 64)
);

create table if not exists public.audit_extraction (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shipment_id uuid not null,
  po_ingest_id uuid not null,
  model_name text not null,
  model_version text not null,
  prompt_template_name text not null,
  prompt_template_version text not null,
  input_sha256 text not null,
  output_json jsonb not null,
  output_sha256 text not null,
  warnings jsonb not null default '[]'::jsonb,
  confidence numeric(4,3),
  created_at timestamptz not null default now(),
  constraint audit_extraction_po_ingest_id_fkey
    foreign key (po_ingest_id) references public.audit_po_ingest(id),
  constraint audit_extraction_input_sha256_check check (length(input_sha256) = 64),
  constraint audit_extraction_output_sha256_check check (length(output_sha256) = 64)
);

create table if not exists public.audit_doc_generation (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shipment_id uuid not null,
  po_ingest_id uuid not null,
  extraction_id uuid not null,
  doc_type text not null,
  model_name text not null,
  model_version text not null,
  prompt_template_name text not null,
  prompt_template_version text not null,
  storage_path text not null,
  output_sha256 text not null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint audit_doc_generation_po_ingest_id_fkey
    foreign key (po_ingest_id) references public.audit_po_ingest(id),
  constraint audit_doc_generation_extraction_id_fkey
    foreign key (extraction_id) references public.audit_extraction(id),
  constraint audit_doc_generation_output_sha256_check check (length(output_sha256) = 64)
);

create table if not exists public.audit_approval (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shipment_id uuid not null,
  doc_generation_id uuid not null,
  message_verbatim text not null,
  whatsapp_message_sid text,
  decision approval_decision not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint audit_approval_doc_generation_id_fkey
    foreign key (doc_generation_id) references public.audit_doc_generation(id)
);

create table if not exists public.audit_sanctions_screen (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shipment_id uuid not null,
  parties_screened jsonb not null,
  lists_checked jsonb not null,
  matches jsonb not null default '[]'::jsonb,
  decision screen_decision not null,
  reviewer_type text not null,
  reviewer_user_id uuid,
  screened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint audit_sanctions_screen_reviewer_type_check
    check (reviewer_type in ('auto', 'human'))
);

create table if not exists public.audit_send (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shipment_id uuid not null,
  doc_generation_ids uuid[] not null,
  recipient_email text not null,
  resend_message_id text,
  delivery_status text not null default 'queued',
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_status_update (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  shipment_id uuid not null,
  from_state shipment_state,
  to_state shipment_state not null,
  source text not null,
  note text,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- methodology library (RAG — the long-term moat's storage layer)
-- ---------------------------------------------------------------------------
-- embedding dimension 1536 — VERIFIED against the live DB on 2026-07-02 via:
--   select atttypmod from pg_attribute
--   where attrelid = 'public.methodology_entries'::regclass and attname = 'embedding';
create table if not exists public.methodology_entries (
  id uuid primary key default gen_random_uuid(),
  category methodology_category not null,
  country_pack text,
  sector text,
  title text not null,
  content text not null,
  source_url text,
  source_date date,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ---------------------------------------------------------------------------
-- row level security: enabled + FORCED on every table (default deny — the
-- only policies are the operator/CHA reads added by migrations 002/010/016)
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.buyers enable row level security;
alter table public.buyers force row level security;
alter table public.shipments enable row level security;
alter table public.shipments force row level security;
alter table public.shipment_items enable row level security;
alter table public.shipment_items force row level security;
alter table public.audit_po_ingest enable row level security;
alter table public.audit_po_ingest force row level security;
alter table public.audit_extraction enable row level security;
alter table public.audit_extraction force row level security;
alter table public.audit_doc_generation enable row level security;
alter table public.audit_doc_generation force row level security;
alter table public.audit_approval enable row level security;
alter table public.audit_approval force row level security;
alter table public.audit_sanctions_screen enable row level security;
alter table public.audit_sanctions_screen force row level security;
alter table public.audit_send enable row level security;
alter table public.audit_send force row level security;
alter table public.audit_status_update enable row level security;
alter table public.audit_status_update force row level security;
alter table public.methodology_entries enable row level security;
alter table public.methodology_entries force row level security;

-- ---------------------------------------------------------------------------
-- immutability triggers on the audit_* family
-- ---------------------------------------------------------------------------
create or replace trigger audit_po_ingest_no_mutation
  before update or delete on public.audit_po_ingest
  for each row execute function public.audit_block_mutation();
create or replace trigger audit_extraction_no_mutation
  before update or delete on public.audit_extraction
  for each row execute function public.audit_block_mutation();
create or replace trigger audit_doc_generation_no_mutation
  before update or delete on public.audit_doc_generation
  for each row execute function public.audit_block_mutation();
create or replace trigger audit_approval_no_mutation
  before update or delete on public.audit_approval
  for each row execute function public.audit_block_mutation();
create or replace trigger audit_sanctions_screen_no_mutation
  before update or delete on public.audit_sanctions_screen
  for each row execute function public.audit_block_mutation();
create or replace trigger audit_send_no_mutation
  before update or delete on public.audit_send
  for each row execute function public.audit_block_mutation();
create or replace trigger audit_status_update_no_mutation
  before update or delete on public.audit_status_update
  for each row execute function public.audit_block_mutation();

-- ---------------------------------------------------------------------------
-- indexes (constraint-backed unique indexes are created by the constraints)
-- ---------------------------------------------------------------------------
create index if not exists customers_phone_hash_idx
  on public.customers (phone_hash);
create unique index if not exists customers_inbound_token
  on public.customers (inbound_token) where (inbound_token is not null);
create unique index if not exists customers_portal_token
  on public.customers (portal_token) where (portal_token is not null);
create index if not exists buyers_customer_id_idx
  on public.buyers (customer_id);
create index if not exists shipments_customer_id_idx
  on public.shipments (customer_id);
create index if not exists shipments_status_idx
  on public.shipments (status);
create index if not exists shipments_created_at_idx
  on public.shipments (created_at desc);
create unique index if not exists shipments_inbound_email_id
  on public.shipments (inbound_email_id) where (inbound_email_id is not null);
create index if not exists shipment_items_shipment_id_idx
  on public.shipment_items (shipment_id);
create index if not exists audit_po_ingest_shipment_id_idx
  on public.audit_po_ingest (shipment_id);
create index if not exists audit_extraction_shipment_id_idx
  on public.audit_extraction (shipment_id);
create index if not exists audit_doc_generation_shipment_id_idx
  on public.audit_doc_generation (shipment_id);
create index if not exists audit_approval_shipment_id_idx
  on public.audit_approval (shipment_id);
create index if not exists audit_sanctions_screen_shipment_id_idx
  on public.audit_sanctions_screen (shipment_id);
create index if not exists audit_send_shipment_id_idx
  on public.audit_send (shipment_id);
create index if not exists audit_status_update_shipment_id_idx
  on public.audit_status_update (shipment_id);
create index if not exists methodology_entries_country_pack_sector_idx
  on public.methodology_entries (country_pack, sector);
-- ivfflat needs the embedding dimension to be correct (see note above).
create index if not exists idx_methodology_embedding
  on public.methodology_entries using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

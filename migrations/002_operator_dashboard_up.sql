-- Migration 002 UP: Operator dashboard (Bucket B)
-- Adds operator role, RLS for operators to see all data, manual extraction fields,
-- and immutable audit log of operator actions.
-- Apply by pasting into Supabase SQL Editor and clicking Run.

-- ============================================================================
-- 1. operators table — who can use the /internal dashboard
-- ============================================================================

create table if not exists public.operators (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'operator' check (role in ('operator', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.operators enable row level security;
alter table public.operators force row level security;

-- Operators can read their own row only.
create policy operators_self_select on public.operators
  for select
  using (id = auth.uid());

-- ============================================================================
-- 2. is_operator() — SECURITY DEFINER bypasses RLS so policies can call it
-- ============================================================================

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.operators where id = auth.uid())
$$;

revoke all on function public.is_operator() from public;
grant execute on function public.is_operator() to authenticated;

-- ============================================================================
-- 3. Add operator-read RLS policies to customer-data tables
-- ============================================================================

create policy customers_operator_select on public.customers
  for select
  using (public.is_operator());

create policy shipments_operator_select on public.shipments
  for select
  using (public.is_operator());

create policy shipments_operator_update on public.shipments
  for update
  using (public.is_operator())
  with check (public.is_operator());

create policy audit_po_ingest_operator_select on public.audit_po_ingest
  for select
  using (public.is_operator());

-- ============================================================================
-- 4. Manual extraction + notes columns on shipments
-- ============================================================================

alter table public.shipments
  add column if not exists extracted_data jsonb not null default '{}'::jsonb,
  add column if not exists notes text;

-- ============================================================================
-- 5. audit_operator_action — immutable log of every dashboard action
-- ============================================================================

create table if not exists public.audit_operator_action (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators (id),
  shipment_id uuid not null references public.shipments (id),
  action_type text not null check (
    action_type in ('extract', 'status_change', 'note', 'approve', 'reject')
  ),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_operator_action_shipment_idx
  on public.audit_operator_action (shipment_id, created_at desc);

create index if not exists audit_operator_action_operator_idx
  on public.audit_operator_action (operator_id, created_at desc);

alter table public.audit_operator_action enable row level security;
alter table public.audit_operator_action force row level security;

create policy audit_operator_action_operator_select on public.audit_operator_action
  for select
  using (public.is_operator());

create policy audit_operator_action_operator_insert on public.audit_operator_action
  for insert
  with check (public.is_operator() and operator_id = auth.uid());

-- Immutability: block UPDATE and DELETE.
create or replace function public.audit_operator_action_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_operator_action rows are immutable';
end;
$$;

drop trigger if exists audit_operator_action_no_update on public.audit_operator_action;
create trigger audit_operator_action_no_update
  before update on public.audit_operator_action
  for each row execute function public.audit_operator_action_block_mutation();

drop trigger if exists audit_operator_action_no_delete on public.audit_operator_action;
create trigger audit_operator_action_no_delete
  before delete on public.audit_operator_action
  for each row execute function public.audit_operator_action_block_mutation();

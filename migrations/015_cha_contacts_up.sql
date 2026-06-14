-- Migration 015 UP: per-exporter CHA (customs broker) list. An exporter can use
-- more than one broker — e.g. a different CHA per port — so brokers move out of
-- the single cha_name/cha_email columns on exporter_profiles into their own
-- table: one row per broker, one marked default for automatic document sends.
-- The old cha_name/cha_email columns are left in place but are no longer read or
-- written. NOTE: rolling this back (015 down) DROPS the broker list — any CHA a
-- customer added after this migration is lost; the old columns are not updated.

create table if not exists public.cha_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null,
  email text,
  port text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists cha_contacts_customer on public.cha_contacts (customer_id);

-- At most one default broker per exporter.
create unique index if not exists cha_contacts_one_default_per_customer
  on public.cha_contacts (customer_id)
  where is_default;

-- Carry over the single CHA already stored on each customer's profile.
insert into public.cha_contacts (customer_id, name, email, is_default)
select customer_id,
       coalesce(nullif(trim(cha_name), ''), 'Customs broker'),
       nullif(trim(cha_email), ''),
       true
from public.exporter_profiles
where customer_id is not null
  and coalesce(trim(cha_email), '') <> '';

-- Customer data: default deny, operators allowed; the service role (onboarding)
-- bypasses RLS as it does for the rest of the customer tables.
alter table public.cha_contacts enable row level security;
alter table public.cha_contacts force row level security;

drop policy if exists cha_contacts_operator_all on public.cha_contacts;
create policy cha_contacts_operator_all on public.cha_contacts
  for all using (public.is_operator()) with check (public.is_operator());

-- Atomic replace of a customer's broker list, called by both the operator and
-- the public onboarding paths. SECURITY INVOKER (the default): the operator path
-- runs under RLS (the operator policy above must pass); the onboarding path runs
-- as the service role and bypasses RLS, as it does for the other customer
-- tables. customer_id is a parameter, so a caller can never write rows for a
-- different exporter, and the whole delete+insert is one transaction — a failed
-- insert rolls back the delete, so the list is never left empty.
create or replace function public.replace_cha_contacts(p_customer_id uuid, p_rows jsonb)
returns void
language plpgsql
as $$
begin
  delete from public.cha_contacts where customer_id = p_customer_id;
  insert into public.cha_contacts (customer_id, name, email, port, is_default)
  select p_customer_id,
         r->>'name',
         nullif(r->>'email', ''),
         nullif(r->>'port', ''),
         coalesce((r->>'is_default')::boolean, false)
  from jsonb_array_elements(p_rows) as r
  where coalesce(trim(r->>'name'), '') <> '';
end;
$$;

-- Only operators (further gated by RLS inside) and the service role may run it.
revoke execute on function public.replace_cha_contacts(uuid, jsonb) from public;
grant execute on function public.replace_cha_contacts(uuid, jsonb) to authenticated, service_role;

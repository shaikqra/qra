-- Migration 010 UP: one exporter profile per customer.
-- exporter_profiles gains a customer_id link; the existing is_default row
-- stays as the fallback used when a customer has no profile of their own.
-- customers gains display_name so operators see names, not UUIDs.

alter table public.customers
  add column if not exists display_name text;

alter table public.exporter_profiles
  add column if not exists customer_id uuid references public.customers (id);

-- At most one profile per customer.
create unique index if not exists exporter_profiles_one_per_customer
  on public.exporter_profiles (customer_id)
  where customer_id is not null;

-- Operators manage customer names from the dashboard (webhook writes use the
-- service role and bypass RLS either way).
drop policy if exists customers_operator_select on public.customers;
create policy customers_operator_select on public.customers
  for select using (public.is_operator());

drop policy if exists customers_operator_update on public.customers;
create policy customers_operator_update on public.customers
  for update using (public.is_operator()) with check (public.is_operator());

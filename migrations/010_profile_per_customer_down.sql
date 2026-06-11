-- Migration 010 DOWN: remove per-customer profiles.
-- customers_operator_update is new in 010, so it is dropped. The select
-- policy predates 010 (migration 002) — restore that version, don't drop it.

drop policy if exists customers_operator_update on public.customers;

drop policy if exists customers_operator_select on public.customers;
create policy customers_operator_select on public.customers
  for select using (public.is_operator());

drop index if exists public.exporter_profiles_one_per_customer;

alter table public.exporter_profiles
  drop column if exists customer_id;

alter table public.customers
  drop column if exists display_name;

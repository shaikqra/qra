-- Migration 018 DOWN: remove the per-exporter inbound email address + dedup key.
drop index if exists public.shipments_inbound_email_id;
alter table public.shipments drop column if exists inbound_email_id;
drop index if exists public.customers_inbound_token;
alter table public.customers drop column if exists inbound_token;

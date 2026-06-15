-- Migration 020 DOWN: remove the per-exporter portal token.
drop index if exists public.customers_portal_token;
alter table public.customers drop column if exists portal_token;

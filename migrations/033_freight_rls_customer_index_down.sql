-- Migration 033 DOWN: reverse the FORCE-RLS and the login index.

drop index if exists customers_whatsapp_number_idx;

alter table public.freight_quotes no force row level security;

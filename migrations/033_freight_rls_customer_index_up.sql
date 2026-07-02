-- Migration 033 UP: harden two customer-data spots that earlier migrations missed.
-- 1. FORCE row level security on freight_quotes. Migration 025 enabled RLS but —
--    unlike every other customer-data table here — never forced it, so the table
--    owner (service_role's underlying role) still bypasses row security. FORCE
--    closes that gap; the default-deny (no policies) from 025 stands unchanged.
-- 2. Index customers(whatsapp_number). Portal login looks an exporter up by this
--    column (src/app/portal/login/actions.ts) and it was unindexed.

alter table public.freight_quotes force row level security;

create index if not exists customers_whatsapp_number_idx
  on public.customers (whatsapp_number);

-- Migration 026 DOWN: remove the G4 freight decision columns + the award index.
drop index if exists public.freight_quotes_one_award;
alter table public.freight_quotes drop column if exists negotiate_target;
alter table public.freight_quotes drop column if exists decided_at;
alter table public.freight_quotes drop column if exists decision;

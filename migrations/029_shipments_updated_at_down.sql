-- Migration 029 DOWN: remove the auto-touch trigger, function, and column.

drop trigger if exists shipments_touch_updated_at on public.shipments;
drop function if exists public.touch_shipments_updated_at();
alter table public.shipments drop column if exists updated_at;

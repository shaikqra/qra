-- Migration 029 UP: shipments.updated_at + an auto-touch trigger.
-- A WhatsApp reply carries no shipment id, so when a customer has several pending
-- shipments we must guess which one the reply is for. The best guess is the one we
-- most recently touched (it just entered a gate, or we just updated it) — so the
-- reply-routing handlers order by updated_at. The trigger keeps it current on
-- every update; the column default backfills existing rows to now().

alter table public.shipments add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_shipments_updated_at() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shipments_touch_updated_at on public.shipments;
create trigger shipments_touch_updated_at
  before update on public.shipments
  for each row execute function public.touch_shipments_updated_at();

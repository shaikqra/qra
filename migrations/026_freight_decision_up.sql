-- Migration 026 UP: the G4 freight decision, recorded per quote.
-- The exporter's G4 gate (in the portal) sets one of: 'awarded' (accept this
-- carrier), 'rejected' (drop it — recommendation moves to next-best), or
-- 'negotiate' (counter toward negotiate_target, ~1.5% below the quoted rate, per
-- the Build Bible's x0.985 step). NULL = open. Reversible.

alter table public.freight_quotes add column if not exists decision text;
alter table public.freight_quotes add column if not exists decided_at timestamptz;
alter table public.freight_quotes add column if not exists negotiate_target numeric;

-- One award per shipment, enforced by the DATABASE. The app's check-then-update
-- isn't atomic under concurrent taps, so two different open quotes could both be
-- awarded — a real freight dispute. This index makes the second award fail.
create unique index if not exists freight_quotes_one_award
  on public.freight_quotes (shipment_id)
  where decision = 'awarded';

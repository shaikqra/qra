-- Migration 025 UP: freight_quotes — carrier quotes for a shipment's RFQ.
-- The Freight agent parses each carrier reply into a structured quote here; the
-- ranker reads them to recommend a carrier at the G4 gate. Operational data, not
-- the audit trail (no immutability trigger). RLS default-deny: only the
-- service-role client (operator/system, and the portal scoped by customer) reads.

create table if not exists public.freight_quotes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  carrier_name text,
  rate_amount numeric,
  rate_currency text,
  transit_days integer,
  free_days integer,
  surcharges text,
  validity text,
  raw_text text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists freight_quotes_shipment on public.freight_quotes (shipment_id);

-- Default-deny: no policies. The service-role client (operator/system) bypasses
-- RLS; the exporter portal reads via the service role scoped to its own shipment.
alter table public.freight_quotes enable row level security;

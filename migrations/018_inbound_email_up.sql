-- Migration 018 UP: per-exporter inbound email address. Each exporter gets a
-- unique secret token; their PO-forwarding address is po-<token>@in.theqra.com.
-- A forwarded PO email is matched back to the exporter by this token (the secret
-- address is the auth — like the WhatsApp number identifies the sender today).
alter table public.customers add column if not exists inbound_token text;

create unique index if not exists customers_inbound_token
  on public.customers (inbound_token) where inbound_token is not null;

-- Dedup key: Resend's stable email id. A webhook retry of the same delivery
-- carries the same id, so this stops retries creating duplicate shipments (and
-- duplicate paid extractions). Unique index is the backstop against a race.
alter table public.shipments add column if not exists inbound_email_id text;

create unique index if not exists shipments_inbound_email_id
  on public.shipments (inbound_email_id) where inbound_email_id is not null;

-- audit_po_ingest.source records the channel ('whatsapp', and now 'email'). The
-- base schema isn't in this repo, so a CHECK like source in ('whatsapp') may
-- exist and would silently reject 'email' (a missing compliance audit row).
-- Drop any source CHECK by introspection (name-agnostic, no data-violation risk)
-- so every channel's ingest is audited. source is system-written, so leaving it
-- unconstrained is acceptable.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.audit_po_ingest'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.audit_po_ingest drop constraint %I', c.conname);
  end loop;
end $$;

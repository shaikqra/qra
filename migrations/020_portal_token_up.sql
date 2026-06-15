-- Migration 020 UP: per-exporter portal access token. The exporter opens a
-- private, read-only web view of THEIR shipments at /portal/<token>. The token
-- IS the credential (a secret "anyone with the link" capability URL), so it must
-- be long + unguessable, and unlike the inbound PO address it's never shown
-- publicly. Read-only surface: the portal performs no writes.
alter table public.customers add column if not exists portal_token text;

create unique index if not exists customers_portal_token
  on public.customers (portal_token) where portal_token is not null;

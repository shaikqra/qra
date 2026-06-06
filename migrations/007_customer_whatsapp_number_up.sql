-- Migration 007 UP: store the customer's WhatsApp number
-- Needed to send documents back. Lives in the RLS-protected customers
-- table; never logged. (Previously only a hash was stored, which made
-- outbound messaging impossible.)

alter table public.customers
  add column if not exists whatsapp_number text;

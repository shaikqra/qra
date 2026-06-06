-- Migration 007 DOWN: remove the WhatsApp number column.

alter table public.customers
  drop column if exists whatsapp_number;

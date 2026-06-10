-- Migration 009 UP: add CHA (customs broker) contact fields to the exporter
-- profile. Used by the "Email documents to CHA" feature to know where to send
-- the generated document set.
alter table public.exporter_profiles
  add column if not exists cha_name text,
  add column if not exists cha_email text;

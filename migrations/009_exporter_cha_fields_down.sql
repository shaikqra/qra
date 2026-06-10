-- Migration 009 DOWN: remove the CHA contact fields.
alter table public.exporter_profiles
  drop column if exists cha_email,
  drop column if exists cha_name;

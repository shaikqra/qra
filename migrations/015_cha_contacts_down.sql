-- Migration 015 DOWN: drop the per-exporter CHA list and its helper.
-- WARNING: this DROPS the broker data — any CHA added after 015 was applied is
-- lost. The old cha_name/cha_email columns on exporter_profiles were never
-- written by the multi-CHA feature, so they hold only their pre-015 values.
drop function if exists public.replace_cha_contacts(uuid, jsonb);
drop index if exists public.cha_contacts_one_default_per_customer;
drop index if exists public.cha_contacts_customer;
drop table if exists public.cha_contacts;

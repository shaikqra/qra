-- Migration 004 DOWN: reverse the Exporter Profile changes.

drop index if exists public.exporter_profiles_one_default;
drop table if exists public.exporter_profiles;

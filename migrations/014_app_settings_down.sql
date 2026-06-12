-- Migration 014 DOWN.
drop policy if exists app_settings_operator_select on public.app_settings;
drop table if exists public.app_settings;

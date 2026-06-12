-- Migration 011 DOWN: remove local denied-party list storage.
-- pg_trgm is left installed; other features may rely on it.

drop policy if exists sanctions_refresh_operator_select on public.sanctions_list_refresh;
drop table if exists public.sanctions_list_refresh;

drop policy if exists sanctions_entries_operator_select on public.sanctions_list_entries;
drop table if exists public.sanctions_list_entries;

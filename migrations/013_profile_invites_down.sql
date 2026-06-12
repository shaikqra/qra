-- Migration 013 DOWN: remove profile-onboarding invites.
drop policy if exists profile_invites_operator_select on public.profile_invites;
drop table if exists public.profile_invites;

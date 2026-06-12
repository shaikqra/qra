-- Migration 013 UP: one-time profile-onboarding invites. The operator invites
-- a customer; the customer fills their exporter profile via a secure link.
-- Only a SHA-256 hash of the token is stored — the link itself is the secret.

create table if not exists public.profile_invites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists profile_invites_customer
  on public.profile_invites (customer_id);

-- Operators may see invites; all writes happen via the service role.
alter table public.profile_invites enable row level security;
alter table public.profile_invites force row level security;

drop policy if exists profile_invites_operator_select on public.profile_invites;
create policy profile_invites_operator_select on public.profile_invites
  for select using (public.is_operator());

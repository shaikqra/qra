-- Migration 014 UP: simple key/value app settings (operator-tunable policy
-- flags). First use: auto_send_cha — whether documents auto-email to the CHA
-- on customer approval, or wait for an operator click.

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
alter table public.app_settings force row level security;

drop policy if exists app_settings_operator_select on public.app_settings;
create policy app_settings_operator_select on public.app_settings
  for select using (public.is_operator());

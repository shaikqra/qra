-- Migration 021 DOWN: remove the audit hash chain. (Leaves pgcrypto installed —
-- other features may rely on it; dropping an extension can break them.)
drop trigger if exists audit_chain on public.audit_operator_action;
drop function if exists public.audit_chain_row();
alter table public.audit_operator_action drop column if exists hash;
alter table public.audit_operator_action drop column if exists prev_hash;

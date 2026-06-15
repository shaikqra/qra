-- Migration 022 DOWN: remove the corrected chain + verifier. (Does not restore
-- 021's forking chain; it removes the chain feature entirely.)
drop trigger if exists audit_chain on public.audit_operator_action;
drop function if exists public.audit_chain_row();
drop function if exists public.verify_audit_chain(uuid);
drop function if exists public.audit_row_hash(text, bigint, uuid, text, jsonb, jsonb, timestamptz);
alter table public.audit_operator_action drop column if exists hash;
alter table public.audit_operator_action drop column if exists prev_hash;
alter table public.audit_operator_action drop column if exists seq;

-- Migration 006 DOWN: restore NOT NULL on operator_id.
-- NOTE: fails if system rows (operator_id IS NULL) exist; delete them first.

alter table public.audit_operator_action
  alter column operator_id set not null;

-- Migration 006 UP: allow system-written audit rows
-- The auto-pipeline records its own actions (extraction, status changes)
-- in audit_operator_action. NULL operator_id = the system acted.

alter table public.audit_operator_action
  alter column operator_id drop not null;

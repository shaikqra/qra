-- Migration 002 DOWN: revert operator dashboard.
-- Run this only if you need to fully roll back migration 002.

drop trigger if exists audit_operator_action_no_delete on public.audit_operator_action;
drop trigger if exists audit_operator_action_no_update on public.audit_operator_action;
drop function if exists public.audit_operator_action_block_mutation();

drop policy if exists audit_operator_action_operator_insert on public.audit_operator_action;
drop policy if exists audit_operator_action_operator_select on public.audit_operator_action;
drop table if exists public.audit_operator_action;

alter table public.shipments
  drop column if exists notes,
  drop column if exists extracted_data;

drop policy if exists audit_po_ingest_operator_select on public.audit_po_ingest;
drop policy if exists shipments_operator_update on public.shipments;
drop policy if exists shipments_operator_select on public.shipments;
drop policy if exists customers_operator_select on public.customers;

drop function if exists public.is_operator();

drop policy if exists operators_self_select on public.operators;
drop table if exists public.operators;

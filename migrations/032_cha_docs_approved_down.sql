-- Migration 032 DOWN: remove the CHA G5 approval gate.

-- Drop the action first.
drop function if exists public.cha_approve_docs(uuid);

-- Revert any 'docs_approved' rows to NULL so the narrower CHECK re-applies cleanly
-- (a 'docs_approved' row would otherwise violate the restored constraint).
update public.shipments set cha_review_status = null where cha_review_status = 'docs_approved';

alter table public.shipments
  drop constraint if exists shipments_cha_review_status_check;
alter table public.shipments
  add constraint shipments_cha_review_status_check
  check (cha_review_status in ('filed', 'changes_requested'));

-- Migration 016 DOWN: remove the CHA seat. Drops the broker policies, helper
-- functions, action functions, and the review columns on shipments. No broker
-- data lives anywhere else, so this is a clean reversal.
drop policy if exists shipments_cha_select on public.shipments;
drop policy if exists gendocs_cha_select on public.generated_documents;
drop policy if exists customers_cha_select on public.customers;

drop function if exists public.cha_mark_filed(uuid, text);
drop function if exists public.cha_request_changes(uuid, text);
drop function if exists public.is_cha_for_customer(uuid);
drop function if exists public.current_user_is_cha();

alter table public.shipments
  drop column if exists cha_review_note,
  drop column if exists cha_review_status,
  drop column if exists cha_reviewed_at;

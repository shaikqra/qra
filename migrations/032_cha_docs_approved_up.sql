-- Migration 032 UP: the CHA's G5 "documents approved" gate (Build Bible §4).
-- The broker reviews the pack (and may correct it conversationally), then APPROVES
-- the document set (G5) before filing & signing on ICEGATE (G6 = cha_mark_filed).
-- We record G5 as a third cha_review_status value rather than a shipment_status
-- enum value, keeping CHA review OUT of the enum exactly as migration 016 chose to
-- (avoids the enum-rebuild pain noted there).
--
-- NOTE: the conversational correction loop itself audits as action_type 'extract'
-- (with by:'cha'), an already-allowed value — so corrections work WITHOUT this
-- migration. Only the "Approve documents (G5)" button needs cha_approve_docs.

-- 1. Allow the new review state. The inline CHECK from 016 is auto-named
--    shipments_cha_review_status_check; drop + re-add it widened.
alter table public.shipments
  drop constraint if exists shipments_cha_review_status_check;
alter table public.shipments
  add constraint shipments_cha_review_status_check
  check (cha_review_status in ('docs_approved', 'filed', 'changes_requested'));

-- 2. The G5 action. SECURITY DEFINER + explicit ownership check, like the other
--    CHA RPCs (016/017). Forgiving and idempotent: records the broker's approval
--    of the document set, never advances shipment_status (filing — G6 — does that),
--    and won't clobber a 'filed' state (filing already implies approval). Audited
--    append-only as an 'approve' action attributed to the broker (operator_id null).
create or replace function public.cha_approve_docs(p_shipment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cust uuid;
begin
  select customer_id into v_cust from public.shipments where id = p_shipment;
  if v_cust is null then raise exception 'shipment not found'; end if;
  if not public.is_cha_for_customer(v_cust) then raise exception 'not your shipment'; end if;
  update public.shipments
    set cha_reviewed_at = now(),
        cha_review_status = 'docs_approved'
  where id = p_shipment
    and coalesce(cha_review_status, '') <> 'filed';
  insert into public.audit_operator_action (operator_id, shipment_id, action_type, new_value)
  values (
    null, p_shipment, 'approve',
    jsonb_build_object('by', 'cha', 'cha_user_id', auth.uid(), 'gate', 'G5_documents')
  );
end;
$$;

revoke execute on function public.cha_approve_docs(uuid) from public;
grant execute on function public.cha_approve_docs(uuid) to authenticated, service_role;

-- Migration 017 UP: audit the CHA's filing decisions. A broker confirming a
-- filing (or requesting changes) is the legally load-bearing human action in the
-- export flow, so it must be an append-only audit event — not only a mutable
-- column on the shipment. The audit_operator_action table already exists (002,
-- made operator-nullable in 006); we widen its action_type set and have the two
-- broker RPCs write to it. operator_id stays null (the actor isn't an operator);
-- the broker is identified by cha_user_id = auth.uid().

alter table public.audit_operator_action
  drop constraint if exists audit_operator_action_action_type_check;
alter table public.audit_operator_action
  add constraint audit_operator_action_action_type_check
  check (action_type in (
    'extract', 'status_change', 'note', 'approve', 'reject',
    'cha_filed', 'cha_changes_requested'
  ));

create or replace function public.cha_mark_filed(p_shipment uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cust uuid;
begin
  select customer_id into v_cust from public.shipments where id = p_shipment;
  if v_cust is null then raise exception 'shipment not found'; end if;
  if not public.is_cha_for_customer(v_cust) then raise exception 'not your shipment'; end if;
  update public.shipments
    set cha_reviewed_at = now(),
        cha_review_status = 'filed',
        cha_review_note = nullif(trim(coalesce(p_note, '')), ''),
        status = case when status = 'customer_approved'
                      then 'filed_with_cha'::public.shipment_status else status end
  where id = p_shipment;
  insert into public.audit_operator_action (operator_id, shipment_id, action_type, new_value)
  values (
    null, p_shipment, 'cha_filed',
    jsonb_build_object(
      'by', 'cha',
      'cha_user_id', auth.uid(),
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );
end;
$$;

create or replace function public.cha_request_changes(p_shipment uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cust uuid;
begin
  select customer_id into v_cust from public.shipments where id = p_shipment;
  if v_cust is null then raise exception 'shipment not found'; end if;
  if not public.is_cha_for_customer(v_cust) then raise exception 'not your shipment'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'a note is required'; end if;
  update public.shipments
    set cha_reviewed_at = now(),
        cha_review_status = 'changes_requested',
        cha_review_note = trim(p_note)
  where id = p_shipment;
  insert into public.audit_operator_action (operator_id, shipment_id, action_type, new_value)
  values (
    null, p_shipment, 'cha_changes_requested',
    jsonb_build_object(
      'by', 'cha',
      'cha_user_id', auth.uid(),
      'note', trim(p_note)
    )
  );
end;
$$;

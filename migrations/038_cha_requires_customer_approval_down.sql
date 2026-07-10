-- Migration 038 DOWN: restore the CHA RPCs WITHOUT the customer-approval
-- precondition. Bodies verbatim from the pre-038 live definitions: cha_mark_filed
-- from 017_audit_cha_actions_up.sql, cha_approve_docs from 032_cha_docs_approved_up.sql.

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

revoke execute on function public.cha_mark_filed(uuid, text) from public;
revoke execute on function public.cha_approve_docs(uuid) from public;
grant execute on function public.cha_mark_filed(uuid, text) to authenticated, service_role;
grant execute on function public.cha_approve_docs(uuid) to authenticated, service_role;

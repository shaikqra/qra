-- Migration 017 DOWN: revert the CHA RPCs to their 016 definitions (no audit
-- write). The action_type CHECK is left widened on purpose — narrowing it would
-- require deleting the 'cha_filed' / 'cha_changes_requested' audit rows already
-- written, and audit rows are immutable. The extra allowed values are harmless.

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
end;
$$;

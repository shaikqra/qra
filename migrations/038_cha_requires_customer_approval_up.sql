-- Migration 038 UP: the CHA can only record filing (G6) / doc-approval (G5) once
-- the EXPORTER has approved the documents (audit #20). Both RPCs previously acted
-- with no customer-approval precondition, so a broker could mark a shipment filed
-- before the exporter ever approved.
--
-- The precondition uses the IMMUTABLE artifact — at least one generated_documents
-- row for the shipment with approved_at non-null — consistent with the Tier-2
-- approved_at hand-off gate (fix #4). If it isn't met we RAISE a message the CHA
-- UI maps to a friendly line (src/app/cha/[id]/actions.ts + cha-correct-actions.ts).
--
-- Bodies are copied from the CURRENTLY-LIVE definitions (cha_mark_filed from 017,
-- which added the audit insert on top of 016; cha_approve_docs from 032) with only
-- the precondition block inserted — the down migration restores those exactly.
-- No enum-vs-text-param comparison is added; the only new SQL is a uuid/timestamptz
-- exists() check, so no ::text cast is required.

create or replace function public.cha_mark_filed(p_shipment uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cust uuid;
begin
  select customer_id into v_cust from public.shipments where id = p_shipment;
  if v_cust is null then raise exception 'shipment not found'; end if;
  if not public.is_cha_for_customer(v_cust) then raise exception 'not your shipment'; end if;
  -- Precondition: the exporter must have approved the documents (>= 1 stamped
  -- generated_documents.approved_at) before a filing can be recorded.
  if not exists (
    select 1 from public.generated_documents
    where shipment_id = p_shipment and approved_at is not null
  ) then
    raise exception 'customer approval required before filing';
  end if;
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
  -- Precondition: the exporter must have approved the documents first (>= 1 stamped
  -- generated_documents.approved_at) before the broker's G5 approval is recorded.
  if not exists (
    select 1 from public.generated_documents
    where shipment_id = p_shipment and approved_at is not null
  ) then
    raise exception 'customer approval required before filing';
  end if;
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

-- Proof the bodies plan/execute (plpgsql plans on first CALL). A dummy uuid falls
-- through to the ownership/precondition checks and RAISEs cleanly, proving the
-- function loads and its entry statements plan. Run once (each raises):
-- select public.cha_mark_filed('00000000-0000-0000-0000-000000000000'::uuid);   -- EXPECTED: shipment not found
-- select public.cha_approve_docs('00000000-0000-0000-0000-000000000000'::uuid); -- EXPECTED: shipment not found
-- (Full precondition path is plain uuid/timestamptz SQL — no enum cast — so it
--  cannot hit the enum=text 42883 trap; exercise it end-to-end on a real approved
--  shipment after deploy to confirm the RAISE fires when approval is missing.)

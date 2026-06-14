-- Migration 016 UP: the CHA seat. A customs broker signs in (Supabase magic
-- link) and reviews / files the export document pack for the shipments handed to
-- them. A broker is recognised by their email appearing in cha_contacts; their
-- access to a shipment derives from being a broker for that shipment's exporter.

-- 1. Where the broker's review lands. Kept OUT of the shipment_status enum so we
--    don't have to surgically rebuild the enum (see migration 008's pain).
alter table public.shipments
  add column if not exists cha_reviewed_at timestamptz,
  add column if not exists cha_review_status text
    check (cha_review_status in ('filed', 'changes_requested')),
  add column if not exists cha_review_note text;

-- 2. Identity helpers. SECURITY DEFINER so they can read cha_contacts regardless
--    of the caller's RLS; auth.email() still reflects the CALLING user inside a
--    definer function (it reads the request JWT, not the function owner).
create or replace function public.is_cha_for_customer(cust uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cha_contacts c
    where c.customer_id = cust
      and lower(c.email) = lower(auth.email())
  );
$$;

create or replace function public.current_user_is_cha()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cha_contacts c
    where lower(c.email) = lower(auth.email())
  );
$$;

-- 3. Read access for the broker: ONLY the shipments (and their documents and the
--    exporter's name) for exporters they are a broker for. Added alongside the
--    existing operator policies (RLS policies are OR-ed), default deny otherwise.
drop policy if exists shipments_cha_select on public.shipments;
create policy shipments_cha_select on public.shipments
  for select using (public.is_cha_for_customer(customer_id));

drop policy if exists gendocs_cha_select on public.generated_documents;
create policy gendocs_cha_select on public.generated_documents
  for select using (exists (
    select 1 from public.shipments s
    where s.id = generated_documents.shipment_id
      and public.is_cha_for_customer(s.customer_id)
  ));

drop policy if exists customers_cha_select on public.customers;
create policy customers_cha_select on public.customers
  for select using (public.is_cha_for_customer(id));

-- 4. The two broker actions. SECURITY DEFINER + an explicit ownership check, so a
--    broker can only act on their own shipments and only ever touch the review
--    fields (never value, parties, status beyond the one allowed transition).
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
        -- Advance status only when the broker reached this through the seat
        -- before it was handed over by email; if it's already filed_with_cha,
        -- the email handover set it and we leave it. cha_review_status is the
        -- precise "broker confirmed filing" signal either way.
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

-- Only authenticated users (brokers, gated by the ownership check inside) and the
-- service role may execute these; not anon/public.
revoke execute on function public.is_cha_for_customer(uuid) from public;
revoke execute on function public.current_user_is_cha() from public;
revoke execute on function public.cha_mark_filed(uuid, text) from public;
revoke execute on function public.cha_request_changes(uuid, text) from public;
grant execute on function public.is_cha_for_customer(uuid) to authenticated, service_role;
grant execute on function public.current_user_is_cha() to authenticated, service_role;
grant execute on function public.cha_mark_filed(uuid, text) to authenticated, service_role;
grant execute on function public.cha_request_changes(uuid, text) to authenticated, service_role;

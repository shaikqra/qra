-- Migration 022 UP: correct the audit hash chain + add chain verification (§8).
--
-- 021 chained rows by created_at with a random-uuid tiebreaker. Several actions
-- write multiple audit rows in ONE transaction (same created_at), so the chain
-- could fork. Re-base it on a strictly monotonic sequence (seq) so simultaneous
-- writes chain linearly, and add verify_audit_chain() to prove a shipment's
-- chain is intact (or locate the first altered row).
--
-- The chain columns are reset (DDL drop/re-add is allowed; the row-immutability
-- trigger only blocks UPDATE/DELETE). Rows written before this migration become
-- unchained (NULL hash); the corrected chain runs forward from here.

-- digest() lives in pgcrypto; keep this migration self-contained.
create extension if not exists pgcrypto;

drop trigger if exists audit_chain on public.audit_operator_action;
drop function if exists public.audit_chain_row();
alter table public.audit_operator_action drop column if exists hash;
alter table public.audit_operator_action drop column if exists prev_hash;

alter table public.audit_operator_action add column if not exists seq bigserial;
alter table public.audit_operator_action add column prev_hash text;
alter table public.audit_operator_action add column hash text;

-- The trigger (on every insert) and the verifier both scan by (shipment_id, seq).
create index if not exists audit_operator_action_shipment_seq
  on public.audit_operator_action (shipment_id, seq);

-- The canonical row fingerprint — shared by the trigger and the verifier, so they
-- can never drift. seq (not created_at) anchors order.
create or replace function public.audit_row_hash(
  p_prev text, p_seq bigint, p_operator uuid, p_action text,
  p_old jsonb, p_new jsonb, p_created timestamptz
) returns text language sql immutable as $$
  select encode(digest(
    coalesce(p_prev,'') || '|' || p_seq::text || '|' ||
    coalesce(p_operator::text,'') || '|' || p_action || '|' ||
    coalesce(p_old::text,'') || '|' || coalesce(p_new::text,'') || '|' ||
    p_created::text, 'sha256'), 'hex');
$$;

create or replace function public.audit_chain_row()
returns trigger language plpgsql as $$
declare v_prev text;
begin
  -- NOTE: audit rows are inserted ONE PER STATEMENT (enforced in the app) so this
  -- BEFORE trigger fires in seq order. Postgres does not guarantee firing order
  -- within a single multi-row insert, which would fork the chain.
  -- Serialise per shipment so concurrent transactions can't fork the chain.
  perform pg_advisory_xact_lock(hashtext(coalesce(NEW.shipment_id::text,'global'))::bigint);
  select hash into v_prev
  from public.audit_operator_action
  where shipment_id is not distinct from NEW.shipment_id and seq < NEW.seq
  order by seq desc limit 1;
  NEW.prev_hash := v_prev;
  NEW.hash := public.audit_row_hash(
    v_prev, NEW.seq, NEW.operator_id, NEW.action_type, NEW.old_value, NEW.new_value, NEW.created_at
  );
  return NEW;
end; $$;

create trigger audit_chain
  before insert on public.audit_operator_action
  for each row execute function public.audit_chain_row();

create or replace function public.verify_audit_chain(p_shipment uuid)
returns table(ok boolean, broken_at bigint, checked integer)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_prev text := null;
  v_checked integer := 0;
  v_ok boolean := true;
  v_broken bigint := null;
begin
  for r in
    select seq, operator_id, action_type, old_value, new_value, created_at, prev_hash, hash
    from public.audit_operator_action
    where shipment_id is not distinct from p_shipment and hash is not null
    order by seq asc
  loop
    v_checked := v_checked + 1;
    if r.prev_hash is distinct from v_prev
       or public.audit_row_hash(r.prev_hash, r.seq, r.operator_id, r.action_type, r.old_value, r.new_value, r.created_at)
          is distinct from r.hash then
      v_ok := false; v_broken := r.seq; exit;
    end if;
    v_prev := r.hash;
  end loop;
  return query select v_ok, v_broken, v_checked;
end; $$;

revoke all on function public.verify_audit_chain(uuid) from public;
grant execute on function public.verify_audit_chain(uuid) to service_role;

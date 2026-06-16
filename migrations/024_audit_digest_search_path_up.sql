-- Migration 024 UP: fix "function digest() does not exist" in verify_audit_chain (§8).
--
-- pgcrypto's digest() lives in the `extensions` schema on Supabase. The INSERT
-- trigger resolves it fine (it inherits the session search_path, which includes
-- extensions), so audit hashes are written correctly. But verify_audit_chain() is
-- SECURITY DEFINER with `set search_path = public`, which EXCLUDES extensions.
-- When the planner inlines audit_row_hash() into the verifier, digest() can't be
-- found -> ERROR 42883. So the verifier never worked on Supabase (latent since 022).
--
-- Fix: give audit_row_hash() its own search_path that includes extensions (this
-- also stops it being inlined, so resolution is stable for every caller), and
-- widen verify_audit_chain()'s search_path to match. digest() and the hashed
-- string are unchanged, so every EXISTING hash still verifies — no chain break.

create or replace function public.audit_row_hash(
  p_prev text, p_seq bigint, p_operator uuid, p_action text,
  p_old jsonb, p_new jsonb, p_created timestamptz
) returns text language sql immutable
  set search_path = public, extensions as $$
  select encode(digest(
    coalesce(p_prev,'') || '|' || p_seq::text || '|' ||
    coalesce(p_operator::text,'') || '|' || p_action || '|' ||
    coalesce(p_old::text,'') || '|' || coalesce(p_new::text,'') || '|' ||
    p_created::text, 'sha256'), 'hex');
$$;

create or replace function public.verify_audit_chain(p_shipment uuid)
returns table(ok boolean, broken_at bigint, checked integer)
language plpgsql security definer set search_path = public, extensions as $$
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

-- Migration 024 DOWN: revert audit_row_hash + verify_audit_chain to the 022
-- definitions (search_path = public; no search_path on audit_row_hash). NOTE: this
-- restores the digest-resolution bug in verify_audit_chain on Supabase — only roll
-- back if you are also rolling back 022. Hash output is unchanged either way.

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

-- Migration 035 UP: atomic shallow-merge of shipments.extracted_data.
--
-- extracted_data is a shared jsonb blob written from many places (the pipeline,
-- the WhatsApp webhook, the portal, the operator + CHA consoles, the advisory
-- agents). The app pattern was read-modify-write: fetch the blob, spread a couple
-- of keys onto it, write the WHOLE blob back. A concurrent write that landed
-- between the fetch and the write was silently clobbered (a recurring race), and
-- the operator Save wrote back ONLY the visible form fields — wiping every
-- reserved underscore key (_lc, _tracking, _booking_draft, ...).
--
-- This function does the same shallow merge, but INSIDE Postgres under the row
-- lock, so it can never lose a concurrent write:
--   extracted_data = (coalesce(extracted_data,'{}') || p_patch) - p_remove
-- `||` is the shallow-merge operator — patch keys win, every other existing key is
-- preserved untouched (exactly like the JS `{ ...old, ...patch }` spread). p_remove
-- deletes named keys (merge alone cannot remove a key); the ONLY caller that needs
-- it is the pipeline dropping a low-confidence packing weight it won't trust.
--
-- p_expected_status re-asserts the shipment's status in the SAME statement, so a
-- guarded caller's write can't land on a shipment that moved on between its read
-- and its write (the optimistic-concurrency guard the correction paths rely on).
-- Returns true when a row matched + was updated, false when none did (the guard
-- failed) — the caller decides what to do.
--
-- SECURITY INVOKER (the default): identical posture to the direct .update() calls
-- it replaces. Service-role callers bypass RLS (as they do today); operator
-- callers run under the shipments_operator_update policy (is_operator()), exactly
-- as their direct update did. No caller gains any access it didn't already have.
-- Mirrors replace_cha_contacts (015): INVOKER, granted to authenticated +
-- service_role, revoked from public.

create or replace function public.merge_extracted_data(
  p_shipment_id uuid,
  p_patch jsonb default '{}'::jsonb,
  p_expected_status text default null,
  p_remove text[] default null
)
returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update public.shipments
     set extracted_data =
           (coalesce(extracted_data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb))
           - coalesce(p_remove, array[]::text[])
   where id = p_shipment_id
     and (p_expected_status is null or status = p_expected_status);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.merge_extracted_data(uuid, jsonb, text, text[]) from public;
grant execute on function public.merge_extracted_data(uuid, jsonb, text, text[]) to authenticated, service_role;

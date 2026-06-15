-- Migration 021 UP: hash-chained, tamper-evident audit trail (Build Bible §8 —
-- "each event chains prev_hash -> hash for tamper-evidence").
--
-- Every audit row now carries:
--   prev_hash : the hash of the previous audit row FOR THE SAME SHIPMENT
--   hash      : sha256( prev_hash + this row's content )
-- so the rows form a chain per shipment. Editing or deleting any historical row
-- (already blocked by the immutability trigger) would also break every hash
-- after it — making tampering detectable, not just disallowed. Chaining is done
-- in the database on INSERT, so every existing write path is covered with no app
-- code change. Forward-only: rows written before this migration keep a NULL hash
-- and the chain begins at the first row inserted after it.

create extension if not exists pgcrypto;

alter table public.audit_operator_action
  add column if not exists prev_hash text,
  add column if not exists hash text;

create or replace function public.audit_chain_row()
returns trigger
language plpgsql
as $$
declare
  v_key  text := coalesce(NEW.shipment_id::text, 'global');
  v_prev text;
begin
  -- Serialise inserts per shipment so two concurrent rows can't fork the chain.
  perform pg_advisory_xact_lock(hashtext(v_key)::bigint);

  select hash into v_prev
  from public.audit_operator_action
  where coalesce(shipment_id::text, 'global') = v_key
  order by created_at desc, id desc
  limit 1;

  NEW.prev_hash := v_prev;
  NEW.hash := encode(
    digest(
      coalesce(v_prev, '') || '|' ||
      NEW.id::text || '|' ||
      coalesce(NEW.operator_id::text, '') || '|' ||
      NEW.action_type || '|' ||
      coalesce(NEW.old_value::text, '') || '|' ||
      coalesce(NEW.new_value::text, '') || '|' ||
      NEW.created_at::text,
      'sha256'
    ),
    'hex'
  );
  return NEW;
end;
$$;

drop trigger if exists audit_chain on public.audit_operator_action;
create trigger audit_chain
  before insert on public.audit_operator_action
  for each row execute function public.audit_chain_row();

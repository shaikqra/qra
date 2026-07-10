-- Migration 036 UP: make generated_documents.approved_at ONE-WAY (audit #15).
-- The 003 immutability trigger froze the CORE columns but left approved_at (and
-- approval_message) freely UPDATEable — a customer's approval TIMESTAMP could be
-- overwritten or cleared after the fact. approved_at is the legal record of WHEN
-- the customer approved, so tighten it: NULL -> a value exactly once; changing an
-- already-set approved_at raises. (approval_message rides with it and stays
-- mutable — approved_at is the load-bearing gate the CHA hand-off checks.)
--
-- SAFE FOR THE SHIPPED FLOWS — verified: every approval path stamps only NULL rows
--   WhatsApp:  .update({approved_at}).is("approved_at", null)   (webhook/route.ts)
--   Portal:    .update({approved_at}).is("approved_at", null)   (portal .../actions.ts)
-- and the CHA re-approve flow (fix #8, commit fd6cd8c) deliberately does NOT
-- re-stamp. None of them UPDATE a row whose approved_at is already set, so this
-- trigger never fires on the live flows — it only blocks a stray overwrite.
--
-- This only re-creates the trigger FUNCTION; the 003 trigger already points at it.

create or replace function public.generated_documents_protect()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'DELETE') then
    raise exception 'generated_documents rows cannot be deleted';
  end if;

  if (
    new.id, new.shipment_id, new.customer_id, new.doc_type, new.storage_path,
    new.output_sha256, new.source_data, new.generator, new.generated_by, new.generated_at
  ) is distinct from (
    old.id, old.shipment_id, old.customer_id, old.doc_type, old.storage_path,
    old.output_sha256, old.source_data, old.generator, old.generated_by, old.generated_at
  ) then
    raise exception 'core columns of generated_documents are immutable';
  end if;

  -- approved_at is write-once: NULL -> value only. Once stamped it is frozen (the
  -- immutable record of the customer's approval time).
  if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
    raise exception 'generated_documents.approved_at is immutable once set';
  end if;

  return new;
end;
$$;

-- Proof it executes (a trigger function is planned on its first FIRING, not a
-- direct CALL, so exercise it with a real UPDATE in a throwaway transaction —
-- run once, expect the RAISE, then ROLLBACK):
-- begin;
--   -- pick any already-approved doc and try to change its approved_at:
--   update public.generated_documents
--     set approved_at = now()
--     where id = (select id from public.generated_documents where approved_at is not null limit 1);
--   -- EXPECTED: ERROR  generated_documents.approved_at is immutable once set
-- rollback;

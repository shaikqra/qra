-- Migration 036 DOWN: restore the 003 immutability trigger function (approved_at
-- freely UPDATEable again). Verbatim from 003_commercial_invoice_up.sql.

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

  return new;
end;
$$;

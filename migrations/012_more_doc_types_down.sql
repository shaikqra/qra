-- Migration 012 DOWN: restore the original three-type constraint. Added as
-- NOT VALID because generated_documents rows are immutable (the protect
-- trigger blocks deletes), so rows of the newer types may legitimately exist;
-- NOT VALID enforces the old rule for new rows without failing on history.

alter table public.generated_documents
  drop constraint if exists generated_documents_doc_type_check;

alter table public.generated_documents
  add constraint generated_documents_doc_type_check check (
    doc_type in ('commercial_invoice', 'packing_list', 'certificate_of_origin')
  ) not valid;

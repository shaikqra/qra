-- Migration 034 DOWN: restore the pre-034 doc-type constraint (without
-- 'lc_cover_letter'). Added as NOT VALID because generated_documents rows are
-- immutable (the protect trigger from migration 003 blocks ANY delete), so any
-- lc_cover_letter rows already generated must stay; NOT VALID enforces the old
-- rule for new rows without failing on — or deleting — history. Same pattern as
-- migration 027's down.

alter table public.generated_documents
  drop constraint if exists generated_documents_doc_type_check;

alter table public.generated_documents
  add constraint generated_documents_doc_type_check check (
    doc_type in (
      'commercial_invoice',
      'packing_list',
      'certificate_of_origin',
      'proforma_invoice',
      'shipping_bill_pack',
      'export_declaration'
    )
  ) not valid;

-- Migration 027 UP: add 'export_declaration' to the generated_documents doc types.
-- The Export Declaration / Annexure carries the exporter's self-declarations
-- (declaration of truth/correctness, LUT, RoDTEP, statement on origin) for the
-- exporter's signature and the CHA's filing. Postgres can't alter a check
-- constraint in place, so drop + re-add it.

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
  );

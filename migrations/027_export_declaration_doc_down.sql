-- Migration 027 DOWN: remove 'export_declaration'. Any such rows are deleted
-- (the generated PDF is regenerable; we never relabel a doc as another type).

delete from public.generated_documents where doc_type = 'export_declaration';

alter table public.generated_documents
  drop constraint if exists generated_documents_doc_type_check;

alter table public.generated_documents
  add constraint generated_documents_doc_type_check check (
    doc_type in (
      'commercial_invoice',
      'packing_list',
      'certificate_of_origin',
      'proforma_invoice',
      'shipping_bill_pack'
    )
  );

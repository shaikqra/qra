-- Migration 012 UP: allow two new generated document types —
-- proforma_invoice (pre-order quote) and shipping_bill_pack (pre-validated
-- data sheet for the CHA's ICEGATE filing).

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

-- Migration 034 UP: add 'lc_cover_letter' to the generated_documents doc types.
-- The LC cover letter is the bank-presentation covering letter that lists the
-- documents presented for negotiation/payment under a Letter of Credit. It is
-- built from the LC's own details captured by the LC check. Postgres can't alter
-- a check constraint in place, so drop + re-add it (same pattern as 027).

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
      'export_declaration',
      'lc_cover_letter'
    )
  );

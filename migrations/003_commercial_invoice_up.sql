-- Migration 003 UP: Commercial Invoice generation
-- Adds a private storage bucket for generated PDFs and an immutable audit
-- table recording every document Qra generates.
-- Apply by pasting into Supabase SQL Editor and clicking Run.

-- ============================================================================
-- 1. Private storage bucket for generated documents
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('generated-docs', 'generated-docs', false)
on conflict (id) do nothing;

-- ============================================================================
-- 2. generated_documents — immutable audit trail of every generated doc
--    (customer ID, generator + version, output hash, source-data snapshot,
--     operator, timestamp, and later the customer's approval — 7-yr retention)
-- ============================================================================

create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id),
  customer_id uuid not null references public.customers (id),
  doc_type text not null check (
    doc_type in ('commercial_invoice', 'packing_list', 'certificate_of_origin')
  ),
  storage_path text not null,
  output_sha256 text not null,
  source_data jsonb not null,        -- snapshot of extracted_data used to build the doc
  generator text not null,           -- e.g. 'pdf-lib / commercial-invoice@v1'
  generated_by uuid not null references public.operators (id),
  generated_at timestamptz not null default now(),
  -- Filled later, when the customer approves via WhatsApp:
  approved_at timestamptz,
  approval_message text
);

create index if not exists generated_documents_shipment_idx
  on public.generated_documents (shipment_id, generated_at desc);

alter table public.generated_documents enable row level security;
alter table public.generated_documents force row level security;

create policy generated_documents_operator_select on public.generated_documents
  for select
  using (public.is_operator());

create policy generated_documents_operator_insert on public.generated_documents
  for insert
  with check (public.is_operator() and generated_by = auth.uid());

-- ============================================================================
-- 3. Immutability: never delete; on update allow ONLY the approval columns
--    to change (so the customer's approval can be recorded later). All core
--    audit columns are frozen at generation time.
-- ============================================================================

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

drop trigger if exists generated_documents_no_delete on public.generated_documents;
create trigger generated_documents_no_delete
  before delete on public.generated_documents
  for each row execute function public.generated_documents_protect();

drop trigger if exists generated_documents_no_core_update on public.generated_documents;
create trigger generated_documents_no_core_update
  before update on public.generated_documents
  for each row execute function public.generated_documents_protect();

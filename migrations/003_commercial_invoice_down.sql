-- Migration 003 DOWN: reverse the Commercial Invoice generation changes.
-- NOTE: the storage bucket delete fails if it still holds objects. Empty the
-- 'generated-docs' bucket first (Supabase Storage UI), then run this.

drop trigger if exists generated_documents_no_core_update on public.generated_documents;
drop trigger if exists generated_documents_no_delete on public.generated_documents;
drop function if exists public.generated_documents_protect();
drop table if exists public.generated_documents;

delete from storage.buckets where id = 'generated-docs';

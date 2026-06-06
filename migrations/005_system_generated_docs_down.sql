-- Migration 005 DOWN: restore the NOT NULL constraint.
-- NOTE: fails if any system-generated rows (generated_by IS NULL) exist;
-- delete or reassign those rows first.

alter table public.generated_documents
  alter column generated_by set not null;

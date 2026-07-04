-- Migration 035 DOWN: remove the atomic merge helper. Callers revert to their own
-- read-modify-write of extracted_data (reintroducing the stale-merge race), so only
-- roll back together with the application code that calls this function.
drop function if exists public.merge_extracted_data(uuid, jsonb, text, text[]);

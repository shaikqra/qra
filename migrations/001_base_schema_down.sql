-- Migration 001 DOWN: remove the base schema.
--
-- ⚠️⚠️ THIS DELETES EVERY CUSTOMER, SHIPMENT, AND AUDIT RECORD. ⚠️⚠️
-- It exists only to satisfy the "every migration is reversible" rule for
-- fresh/staging environments. NEVER run it against the live project — the
-- audit tables carry a 7-year retention obligation. There is no undo.

-- Reverse dependency order (children first).
drop table if exists public.methodology_entries;
drop table if exists public.audit_status_update;
drop table if exists public.audit_send;
drop table if exists public.audit_sanctions_screen;
drop table if exists public.audit_approval;
drop table if exists public.audit_doc_generation;
drop table if exists public.audit_extraction;
drop table if exists public.audit_po_ingest;
drop table if exists public.shipment_items;
drop table if exists public.shipments;
drop table if exists public.buyers;
drop table if exists public.customers;

drop function if exists public.audit_block_mutation();

drop type if exists public.methodology_category;
drop type if exists public.screen_decision;
drop type if exists public.approval_decision;
drop type if exists public.shipment_status;
drop type if exists public.shipment_state;
drop type if exists public.source_channel;

-- The vector extension is left installed (shared infrastructure).

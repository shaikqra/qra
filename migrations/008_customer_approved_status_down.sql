-- Migration 008 DOWN: remove 'customer_approved' from shipment_status.
-- Postgres can't drop an enum value in place, so we recreate the type without
-- it. Any shipment currently on 'customer_approved' is moved back to
-- 'awaiting_customer_approval' first. Assumes shipments.status is the only
-- column using this enum (true as of migration 008) and that the column's
-- default was 'po_received'.

-- 1. Move rows off the value being removed.
update public.shipments
  set status = 'awaiting_customer_approval'
  where status = 'customer_approved';

-- 2. Recreate the enum type without 'customer_approved'.
alter type public.shipment_status rename to shipment_status_old;

create type public.shipment_status as enum (
  'po_received',
  'data_extracting',
  'awaiting_customer_info',
  'generating_documents',
  'sanctions_screening',
  'bucket_b_review',
  'awaiting_customer_approval',
  'filed_with_cha',
  'customs_cleared',
  'in_transit',
  'delivered',
  'completed',
  'rejected'
);

-- 3. Point the column at the new type (drop default, cast, restore default).
alter table public.shipments alter column status drop default;
alter table public.shipments
  alter column status type public.shipment_status
  using status::text::public.shipment_status;
alter table public.shipments
  alter column status set default 'po_received'::public.shipment_status;

-- 4. Drop the old type.
drop type public.shipment_status_old;

-- Migration 023 DOWN: remove 'awaiting_customer_verify'.
-- Postgres can't drop an enum value in place, so recreate the type without it
-- (mirrors 019 down). In-flight rows on the removed value fall back to
-- 'bucket_b_review' so the operator can still finish them. Assumes
-- shipments.status is the only column on this enum (true as of 023) and the
-- column default is 'po_received'.

-- 1. Move rows off the value being removed.
update public.shipments set status = 'bucket_b_review' where status = 'awaiting_customer_verify';

-- 2. Recreate the enum without it.
alter type public.shipment_status rename to shipment_status_old;

create type public.shipment_status as enum (
  'po_received',
  'data_extracting',
  'awaiting_order_confirm',
  'awaiting_customer_info',
  'generating_documents',
  'sanctions_screening',
  'bucket_b_review',
  'awaiting_customer_approval',
  'customer_approved',
  'filed_with_cha',
  'customs_cleared',
  'in_transit',
  'delivered',
  'completed',
  'rejected',
  'order_declined'
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

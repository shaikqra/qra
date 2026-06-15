-- Migration 019 DOWN: remove 'awaiting_order_confirm' and 'order_declined'.
-- Postgres can't drop an enum value in place, so recreate the type without them
-- (mirrors 008 down). Rows on a removed value are moved to a safe prior state
-- first. Assumes shipments.status is the only column using this enum (true as of
-- 019) and that the column default is 'po_received'.

-- 1. Move rows off the values being removed.
update public.shipments set status = 'po_received' where status = 'awaiting_order_confirm';
update public.shipments set status = 'rejected' where status = 'order_declined';

-- 2. Recreate the enum without the two values.
alter type public.shipment_status rename to shipment_status_old;

create type public.shipment_status as enum (
  'po_received',
  'data_extracting',
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

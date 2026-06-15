-- Migration 019 UP: add the order-confirm gate statuses to shipment_status.
-- A PO that arrives by forwarded EMAIL is drafted (extracted), then parks at
-- 'awaiting_order_confirm' until the exporter confirms it on WhatsApp — the
-- blueprint intake-agent human_gate = order.confirm. The WhatsApp path skips
-- this (sending the PO is itself the confirmation). 'order_declined' is the
-- terminal state when the exporter replies that it isn't a PO to process.

alter type public.shipment_status
  add value if not exists 'awaiting_order_confirm' after 'data_extracting';
alter type public.shipment_status
  add value if not exists 'order_declined' after 'rejected';

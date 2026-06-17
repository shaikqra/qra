-- Migration 028 UP: add 'awaiting_goods_ready' to shipment_status (G3 gate).
-- After the exporter approves the document set, the shipment waits here until the
-- exporter confirms the goods are actually ready to ship — the Build Bible's G3
-- (goods readiness, exporter-owned). Only then is the pack handed to the CHA for
-- filing (you don't file a shipping bill for goods that aren't ready yet).
-- Positioned between awaiting_customer_approval and customer_approved.

alter type public.shipment_status
  add value if not exists 'awaiting_goods_ready' after 'awaiting_customer_approval';

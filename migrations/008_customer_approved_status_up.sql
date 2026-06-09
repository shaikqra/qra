-- Migration 008 UP: add a 'customer_approved' status to shipment_status.
-- Recorded when a customer approves their documents on WhatsApp, so the board
-- reflects the approval instead of staying on 'awaiting_customer_approval'.
-- Positioned right after awaiting_customer_approval for a sensible sort order.

alter type public.shipment_status
  add value if not exists 'customer_approved' after 'awaiting_customer_approval';

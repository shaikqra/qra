-- Migration 023 UP: add 'awaiting_customer_verify' to shipment_status.
-- When extraction is uncertain (a low-confidence field) or a value looks
-- malformed, the agent surfaces those exact fields to the EXPORTER to verify or
-- correct — the blueprint's G1 gate ("the extracted order is correct", §4).
-- Previously that data doubt routed to the internal operator queue
-- (bucket_b_review), which contradicts G1 (the exporter owns order correctness).
-- Sanctions / denied-party hits still route to the operator (sanctions_screening)
-- — those are a compliance stop, not the exporter's call.

alter type public.shipment_status
  add value if not exists 'awaiting_customer_verify' after 'awaiting_customer_info';

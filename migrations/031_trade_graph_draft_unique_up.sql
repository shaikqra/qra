-- One DRAFT rule per lane. storeDraftRule already no-ops when a rule exists, but
-- two concurrent shipments on a BRAND-NEW lane can both pass that read-then-insert
-- check and both insert, leaving duplicate drafts on the analyst desk. This partial
-- unique index makes the second insert fail (handled gracefully in code, code
-- 23505 is ignored) so a lane never accumulates duplicate drafts.
-- Mirrors 030's verified-only unique index; together they keep at most one draft
-- AND one verified row per lane.
create unique index if not exists trade_graph_rules_one_draft
  on trade_graph_rules (rule_type, lane_key)
  where status = 'draft';

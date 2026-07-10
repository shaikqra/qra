-- Migration 037 UP: FORCE row level security on trade_graph_rules (audit #18).
-- 030 ENABLEd RLS (default-deny) but did not FORCE it, so the table OWNER still
-- bypasses the policies. There is no customer PII here (version-pinned reference
-- rules), but house style is enabled + FORCEd on every table — close the gap so
-- only the service-role reader touches it, matching every other Qra table.

alter table public.trade_graph_rules force row level security;

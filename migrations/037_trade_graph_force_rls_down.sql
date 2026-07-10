-- Migration 037 DOWN: revert to ENABLEd-but-not-FORCEd (the 030 state).

alter table public.trade_graph_rules no force row level security;

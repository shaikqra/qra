-- Migration 030 DOWN: drop the Trade Graph table (+ its indexes via cascade).

drop table if exists public.trade_graph_rules;

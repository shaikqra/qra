-- Migration 030 UP: the Trade Graph — export rules as DATA (cited, version-pinned).
-- The Build Bible's moat: "rules-as-data, citations, version-pinned"; "a new lane
-- is drafted by the AI with citations, verified once by an analyst, then instant
-- forever." Agents read a VERIFIED rule for a lane instead of re-asking the model;
-- a miss is AI-drafted and queued for an analyst to verify once.
-- lane_key = "<destination>|hs<heading>" (destination + product family, 4-digit HS).
-- Reference data, not customer data — but RLS default-deny per house style; the
-- service-role client (agents + the operator/analyst surface) is the only reader.

create table if not exists public.trade_graph_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null,                 -- e.g. 'required_certs' (more types later)
  lane_key text not null,                  -- normalized "<destination>|hs<chapter>"
  payload jsonb not null,                  -- the rule content (e.g. the cert array)
  citation text,                           -- source: notification / circular / regulation + ref
  status text not null default 'draft' check (status in ('draft', 'verified')),
  version integer not null default 1,
  created_by uuid,                         -- analyst who created it; null = system/AI draft
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- One ACTIVE (verified) rule per lane+type — the authoritative answer. Drafts are
-- not constrained (a lane can hold a draft awaiting verification).
create unique index if not exists trade_graph_rules_active
  on public.trade_graph_rules (rule_type, lane_key)
  where status = 'verified';

create index if not exists trade_graph_rules_lane
  on public.trade_graph_rules (rule_type, lane_key);

alter table public.trade_graph_rules enable row level security;

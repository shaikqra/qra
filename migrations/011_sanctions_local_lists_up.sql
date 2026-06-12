-- Migration 011 UP: local denied-party list storage (UN now, EU/DGFT later).
-- Lists we ingest ourselves (no per-call API) live here and are matched with
-- trigram similarity. provider distinguishes 'UN', 'EU', etc.

create extension if not exists pg_trgm;

create table if not exists public.sanctions_list_entries (
  id uuid primary key default gen_random_uuid(),
  provider text not null,            -- 'UN', 'EU', 'DGFT'
  entry_type text not null,          -- 'individual' | 'entity'
  full_name text not null,
  normalized_name text not null,     -- lowercased, punctuation-stripped
  fetched_at timestamptz not null default now()
);

-- Trigram index for fuzzy name search.
create index if not exists sanctions_entries_name_trgm
  on public.sanctions_list_entries
  using gin (normalized_name gin_trgm_ops);

create index if not exists sanctions_entries_provider
  on public.sanctions_list_entries (provider);

-- Fuzzy match a query name against all loaded lists. Index-assisted via the
-- `%` operator (default trigram threshold), then narrowed to min_sim.
create or replace function public.match_sanctions(query_name text, min_sim real default 0.45)
returns table(provider text, entry_type text, full_name text, score real)
language sql
stable
as $$
  select e.provider, e.entry_type, e.full_name,
         similarity(e.normalized_name, query_name) as score
  from public.sanctions_list_entries e
  where e.normalized_name % query_name
    and similarity(e.normalized_name, query_name) >= min_sim
  order by score desc
  limit 20;
$$;

-- Completion marker: a provider counts as "loaded" only when a successful
-- full refresh wrote a row here. A partial/failed ingest leaves no marker, so
-- screening treats the provider as unchecked (fail closed). completed_at also
-- drives the staleness ceiling.
create table if not exists public.sanctions_list_refresh (
  provider text primary key,
  completed_at timestamptz not null,
  row_count integer not null
);

-- Operators may read the list; writes happen via the service role (ingestion).
alter table public.sanctions_list_entries enable row level security;
alter table public.sanctions_list_entries force row level security;

drop policy if exists sanctions_entries_operator_select on public.sanctions_list_entries;
create policy sanctions_entries_operator_select on public.sanctions_list_entries
  for select using (public.is_operator());

alter table public.sanctions_list_refresh enable row level security;
alter table public.sanctions_list_refresh force row level security;

drop policy if exists sanctions_refresh_operator_select on public.sanctions_list_refresh;
create policy sanctions_refresh_operator_select on public.sanctions_list_refresh
  for select using (public.is_operator());

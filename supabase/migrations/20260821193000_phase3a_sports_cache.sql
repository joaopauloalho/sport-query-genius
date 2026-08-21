-- Phase 3A: server-side cache for real football provider data.
-- No auth/user/billing tables are introduced here.

create table if not exists public.sports_provider_teams (
  provider text not null,
  provider_team_id bigint not null,
  name text not null,
  normalized_name text not null,
  country text not null default '',
  fetched_at timestamptz not null default now(),
  fixtures_fetched_at timestamptz,
  fixtures_requested_count integer not null default 0 check (fixtures_requested_count >= 0),
  fixtures_returned_count integer not null default 0 check (fixtures_returned_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_team_id)
);

create index if not exists sports_provider_teams_normalized_name_idx
  on public.sports_provider_teams (provider, normalized_name);

create table if not exists public.sports_fixtures (
  provider text not null,
  provider_fixture_id bigint not null,
  kickoff_at timestamptz not null,
  fixture_timestamp bigint not null,
  competition text not null,
  home_provider_team_id bigint not null,
  home_team_name text not null,
  away_provider_team_id bigint not null,
  away_team_name text not null,
  home_goals integer,
  away_goals integer,
  status text not null,
  provider_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_fixture_id)
);

create index if not exists sports_fixtures_home_team_recent_idx
  on public.sports_fixtures (provider, home_provider_team_id, fixture_timestamp desc);

create index if not exists sports_fixtures_away_team_recent_idx
  on public.sports_fixtures (provider, away_provider_team_id, fixture_timestamp desc);

create table if not exists public.sports_fixture_team_metrics (
  provider text not null,
  provider_fixture_id bigint not null,
  team_provider_id bigint not null,
  metric text not null check (metric in ('corners', 'goals', 'shots', 'shots_on_target', 'cards')),
  value numeric,
  source_provider text not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_fixture_id, team_provider_id, metric),
  foreign key (provider, provider_fixture_id)
    references public.sports_fixtures (provider, provider_fixture_id)
    on delete cascade
);

create index if not exists sports_fixture_team_metrics_team_idx
  on public.sports_fixture_team_metrics (provider, team_provider_id, metric, fetched_at desc);

-- This cache is backend infrastructure. No browser/user role receives direct table access.
alter table public.sports_provider_teams enable row level security;
alter table public.sports_fixtures enable row level security;
alter table public.sports_fixture_team_metrics enable row level security;

revoke all on table public.sports_provider_teams from anon, authenticated;
revoke all on table public.sports_fixtures from anon, authenticated;
revoke all on table public.sports_fixture_team_metrics from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.sports_provider_teams to service_role;
grant select, insert, update, delete on table public.sports_fixtures to service_role;
grant select, insert, update, delete on table public.sports_fixture_team_metrics to service_role;

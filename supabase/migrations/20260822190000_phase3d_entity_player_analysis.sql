-- Phase 3D: deterministic entity aliases plus backend-only football player cache.
-- Canonical provider entities remain provider-scoped. Aliases never overwrite a real entity.

create table if not exists public.sports_entity_aliases (
  sport text not null default 'football' check (sport = 'football'),
  entity_type text not null check (entity_type in ('team', 'player')),
  alias text not null,
  normalized_alias text not null,
  provider text not null,
  provider_entity_id bigint not null,
  canonical_name text not null,
  confidence numeric(4,3) not null default 1 check (confidence >= 0 and confidence <= 1),
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sport, entity_type, provider, normalized_alias)
);

create index if not exists sports_entity_aliases_entity_idx
  on public.sports_entity_aliases (provider, entity_type, provider_entity_id);

create table if not exists public.sports_provider_players (
  provider text not null,
  provider_player_id bigint not null,
  name text not null,
  normalized_name text not null,
  current_provider_team_id bigint,
  current_team_name text,
  position text,
  country text not null default '',
  fetched_at timestamptz not null default now(),
  stats_fetched_at timestamptz,
  stats_requested_count integer not null default 0 check (stats_requested_count >= 0),
  stats_returned_count integer not null default 0 check (stats_returned_count >= 0),
  events_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_player_id)
);

create index if not exists sports_provider_players_normalized_name_idx
  on public.sports_provider_players (provider, normalized_name);

create table if not exists public.sports_player_fixture_stats (
  provider text not null,
  provider_fixture_id bigint not null,
  provider_player_id bigint not null,
  kickoff_at timestamptz not null,
  fixture_timestamp bigint not null,
  competition text not null,
  team_provider_id bigint,
  team_name text,
  opponent_provider_id bigint,
  opponent_name text not null,
  venue text not null check (venue in ('home', 'away')),
  result text not null default '',
  minutes integer check (minutes is null or minutes >= 0),
  goals integer check (goals is null or goals >= 0),
  assists integer check (assists is null or assists >= 0),
  shots integer check (shots is null or shots >= 0),
  shots_on_target integer check (shots_on_target is null or shots_on_target >= 0),
  cards integer check (cards is null or cards >= 0),
  shotmap_covered boolean not null default false,
  shotmap_checked_at timestamptz,
  source_provider text not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_fixture_id, provider_player_id),
  foreign key (provider, provider_player_id)
    references public.sports_provider_players (provider, provider_player_id)
    on delete cascade
);

create index if not exists sports_player_fixture_stats_recent_idx
  on public.sports_player_fixture_stats (provider, provider_player_id, fixture_timestamp desc);

create table if not exists public.sports_player_events (
  provider text not null,
  provider_fixture_id bigint not null,
  provider_player_id bigint not null,
  event_key text not null,
  event_type text not null check (event_type = 'goal'),
  kickoff_at timestamptz not null,
  fixture_timestamp bigint not null,
  competition text not null,
  team_provider_id bigint,
  team_name text,
  opponent_provider_id bigint,
  opponent_name text not null,
  venue text not null check (venue in ('home', 'away')),
  result text not null default '',
  minute integer check (minute is null or minute >= 0),
  extra_time integer check (extra_time is null or extra_time >= 0),
  situation text,
  body_part text,
  xg numeric,
  xg_estimated boolean,
  source_provider text not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_player_id, event_key),
  foreign key (provider, provider_player_id)
    references public.sports_provider_players (provider, provider_player_id)
    on delete cascade
);

create index if not exists sports_player_events_recent_idx
  on public.sports_player_events (provider, provider_player_id, fixture_timestamp desc, minute desc);

insert into public.sports_entity_aliases
  (sport, entity_type, alias, normalized_alias, provider, provider_entity_id, canonical_name, confidence, source)
values
  ('football', 'team', 'Bayern de Munique', 'bayern de munique', 'BSD', 79, 'FC Bayern München', 1, 'verified_seed'),
  ('football', 'team', 'Bayern Munich', 'bayern munich', 'BSD', 79, 'FC Bayern München', 1, 'verified_seed'),
  ('football', 'team', 'Bayern München', 'bayern munchen', 'BSD', 79, 'FC Bayern München', 1, 'verified_seed'),
  ('football', 'team', 'FC Bayern München', 'fc bayern munchen', 'BSD', 79, 'FC Bayern München', 1, 'verified_seed'),
  ('football', 'team', 'PSG', 'psg', 'BSD', 114, 'Paris Saint-Germain', 1, 'verified_seed'),
  ('football', 'team', 'Paris SG', 'paris sg', 'BSD', 114, 'Paris Saint-Germain', 1, 'verified_seed'),
  ('football', 'team', 'Inter de Milão', 'inter de milao', 'BSD', 77, 'Inter', 1, 'verified_seed'),
  ('football', 'team', 'Inter Milan', 'inter milan', 'BSD', 77, 'Inter', 1, 'verified_seed'),
  ('football', 'team', 'Atlético de Madrid', 'atletico de madrid', 'BSD', 54, 'Atlético Madrid', 1, 'verified_seed'),
  ('football', 'team', 'Atletico Madrid', 'atletico madrid', 'BSD', 54, 'Atlético Madrid', 1, 'verified_seed'),
  ('football', 'team', 'Borussia de Dortmund', 'borussia de dortmund', 'BSD', 92, 'Borussia Dortmund', 1, 'verified_seed'),
  ('football', 'player', 'Yuri Alberto', 'yuri alberto', 'BSD', 1146, 'Yuri Alberto', 1, 'verified_seed')
on conflict (sport, entity_type, provider, normalized_alias) do update
set provider_entity_id = excluded.provider_entity_id,
    canonical_name = excluded.canonical_name,
    confidence = excluded.confidence,
    source = excluded.source,
    updated_at = now();

alter table public.sports_entity_aliases enable row level security;
alter table public.sports_provider_players enable row level security;
alter table public.sports_player_fixture_stats enable row level security;
alter table public.sports_player_events enable row level security;

revoke all on table public.sports_entity_aliases from anon, authenticated;
revoke all on table public.sports_provider_players from anon, authenticated;
revoke all on table public.sports_player_fixture_stats from anon, authenticated;
revoke all on table public.sports_player_events from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.sports_entity_aliases to service_role;
grant select, insert, update, delete on table public.sports_provider_players to service_role;
grant select, insert, update, delete on table public.sports_player_fixture_stats to service_role;
grant select, insert, update, delete on table public.sports_player_events to service_role;

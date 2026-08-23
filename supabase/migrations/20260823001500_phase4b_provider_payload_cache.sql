-- Phase 4B: generic backend-only provider payload cache.
-- Stores provider data families, never question-specific answers.

create table if not exists public.sports_provider_payload_cache (
  provider text not null,
  data_family text not null,
  cache_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, data_family, cache_key),
  constraint sports_provider_payload_cache_provider_not_blank
    check (char_length(btrim(provider)) between 1 and 40),
  constraint sports_provider_payload_cache_family_not_blank
    check (char_length(btrim(data_family)) between 1 and 80),
  constraint sports_provider_payload_cache_key_not_blank
    check (char_length(btrim(cache_key)) between 1 and 500),
  constraint sports_provider_payload_cache_expiry_order
    check (expires_at >= fetched_at)
);

create index if not exists sports_provider_payload_cache_expires_at_idx
  on public.sports_provider_payload_cache (expires_at);

create index if not exists sports_provider_payload_cache_family_expiry_idx
  on public.sports_provider_payload_cache (provider, data_family, expires_at desc);

alter table public.sports_provider_payload_cache enable row level security;

-- This table is server infrastructure. Browser roles get no table privileges and no RLS policies.
revoke all on table public.sports_provider_payload_cache from anon, authenticated;
grant all on table public.sports_provider_payload_cache to service_role;

comment on table public.sports_provider_payload_cache is
  'Server-only cache of provider data families keyed by provider/data_family/cache_key. Stores raw/normalized provider data, never user-specific answers.';

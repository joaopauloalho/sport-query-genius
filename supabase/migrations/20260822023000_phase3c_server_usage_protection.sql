-- Phase 3C: server-authoritative analysis usage, abuse protection and history writes.
-- Commercial quota is intentionally disabled unless the server provides both quota inputs.

create table if not exists public.analysis_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null unique,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  status text not null check (
    status in (
      'started',
      'completed',
      'failed_user',
      'failed_provider',
      'failed_internal',
      'blocked_rate_limit',
      'blocked_quota',
      'blocked_concurrency'
    )
  ),
  metric text,
  aggregation text,
  match_count integer check (match_count is null or match_count >= 0),
  provider text,
  cache_status text not null default 'unknown' check (
    cache_status in ('hit', 'miss', 'mixed', 'unknown')
  ),
  cache_hit_count integer not null default 0 check (cache_hit_count >= 0),
  cache_miss_count integer not null default 0 check (cache_miss_count >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text,
  analysis_history_id uuid references public.analysis_history(id) on delete set null
);

create unique index if not exists analysis_usage_user_idempotency_uidx
  on public.analysis_usage_events (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists analysis_usage_user_created_idx
  on public.analysis_usage_events (user_id, created_at desc);

create index if not exists analysis_usage_active_lease_idx
  on public.analysis_usage_events (user_id, lease_expires_at)
  where status = 'started';

alter table public.analysis_usage_events enable row level security;

revoke all on table public.analysis_usage_events from anon, authenticated, service_role;
grant select on table public.analysis_usage_events to authenticated;
grant select, insert, update, delete on table public.analysis_usage_events to service_role;

create policy analysis_usage_select_own
  on public.analysis_usage_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- History is readable/deletable by its owner for UX, but only the backend may create
-- or mutate authoritative history rows after Phase 3C.
revoke insert, update on table public.analysis_history from authenticated;
drop policy if exists analysis_history_insert_own on public.analysis_history;
drop policy if exists analysis_history_update_own on public.analysis_history;

create or replace function public.begin_analysis_usage(
  p_user_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_burst_limit integer,
  p_burst_window_seconds integer,
  p_max_concurrent integer,
  p_lease_seconds integer,
  p_quota_limit integer default null,
  p_quota_window_seconds integer default null
)
returns table (
  decision text,
  usage_event_id uuid,
  analysis_history_id uuid,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing_id uuid;
  v_existing_status text;
  v_existing_lease timestamptz;
  v_existing_history uuid;
  v_count bigint;
  v_new_id uuid;
begin
  if p_user_id is null or p_request_id is null or p_idempotency_key is null then
    raise exception 'missing required usage identity';
  end if;
  if p_burst_limit <= 0 or p_burst_window_seconds <= 0 or p_max_concurrent <= 0 or p_lease_seconds <= 0 then
    raise exception 'invalid usage guard configuration';
  end if;
  if (p_quota_limit is null) <> (p_quota_window_seconds is null) then
    raise exception 'incomplete quota configuration';
  end if;
  if p_quota_limit is not null and (p_quota_limit <= 0 or p_quota_window_seconds <= 0) then
    raise exception 'invalid quota configuration';
  end if;

  -- Serialize gate decisions for one user across all serverless instances.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 3301)
  );

  select e.id, e.status, e.lease_expires_at, e.analysis_history_id
    into v_existing_id, v_existing_status, v_existing_lease, v_existing_history
  from public.analysis_usage_events as e
  where e.user_id = p_user_id
    and e.idempotency_key = p_idempotency_key
  order by e.created_at desc
  limit 1;

  if found then
    if v_existing_status = 'completed' then
      return query select 'duplicate_completed'::text, v_existing_id, v_existing_history, null::integer;
      return;
    end if;
    if v_existing_status = 'started' and v_existing_lease is not null and v_existing_lease > v_now then
      return query select
        'duplicate_in_progress'::text,
        v_existing_id,
        v_existing_history,
        greatest(1, ceil(extract(epoch from (v_existing_lease - v_now)))::integer);
      return;
    end if;
    return query select 'duplicate_terminal'::text, v_existing_id, v_existing_history, null::integer;
    return;
  end if;

  -- Burst protection counts authenticated attempts, including blocked attempts.
  select count(*) into v_count
  from public.analysis_usage_events as e
  where e.user_id = p_user_id
    and e.created_at >= v_now - (p_burst_window_seconds * interval '1 second');

  if v_count >= p_burst_limit then
    insert into public.analysis_usage_events (user_id, request_id, status, error_code)
    values (p_user_id, p_request_id, 'blocked_rate_limit', 'RATE_LIMITED')
    returning id into v_new_id;
    return query select 'rate_limited'::text, v_new_id, null::uuid, p_burst_window_seconds;
    return;
  end if;

  -- Optional quota foundation. No commercial limit exists unless both values are supplied.
  if p_quota_limit is not null then
    select count(*) into v_count
    from public.analysis_usage_events as e
    where e.user_id = p_user_id
      and e.created_at >= v_now - (p_quota_window_seconds * interval '1 second')
      and e.status in ('started', 'completed', 'failed_user', 'failed_provider', 'failed_internal');

    if v_count >= p_quota_limit then
      insert into public.analysis_usage_events (user_id, request_id, status, error_code)
      values (p_user_id, p_request_id, 'blocked_quota', 'QUOTA_EXCEEDED')
      returning id into v_new_id;
      return query select 'quota_blocked'::text, v_new_id, null::uuid, p_quota_window_seconds;
      return;
    end if;
  end if;

  select count(*) into v_count
  from public.analysis_usage_events as e
  where e.user_id = p_user_id
    and e.status = 'started'
    and e.lease_expires_at > v_now;

  if v_count >= p_max_concurrent then
    insert into public.analysis_usage_events (user_id, request_id, status, error_code)
    values (p_user_id, p_request_id, 'blocked_concurrency', 'ANALYSIS_IN_PROGRESS')
    returning id into v_new_id;
    return query select 'concurrency_blocked'::text, v_new_id, null::uuid, least(p_lease_seconds, 30);
    return;
  end if;

  insert into public.analysis_usage_events (
    user_id,
    request_id,
    idempotency_key,
    status,
    started_at,
    lease_expires_at
  )
  values (
    p_user_id,
    p_request_id,
    p_idempotency_key,
    'started',
    v_now,
    v_now + (p_lease_seconds * interval '1 second')
  )
  returning id into v_new_id;

  return query select 'allowed'::text, v_new_id, null::uuid, null::integer;
end;
$$;

create or replace function public.complete_analysis_usage(
  p_user_id uuid,
  p_usage_event_id uuid,
  p_question text,
  p_cache_key text,
  p_result_json jsonb,
  p_result_created_at timestamptz,
  p_metric text,
  p_aggregation text,
  p_match_count integer,
  p_provider text,
  p_cache_status text,
  p_cache_hit_count integer,
  p_cache_miss_count integer,
  p_duration_ms integer
)
returns table (history_id uuid, history_created_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_history_id uuid;
  v_history_created_at timestamptz;
begin
  if p_cache_status not in ('hit', 'miss', 'mixed', 'unknown') then
    raise exception 'invalid cache status';
  end if;
  if p_cache_hit_count < 0 or p_cache_miss_count < 0 or p_duration_ms < 0 then
    raise exception 'invalid analysis telemetry';
  end if;

  perform 1
  from public.analysis_usage_events as e
  where e.id = p_usage_event_id
    and e.user_id = p_user_id
    and e.status = 'started'
  for update;

  if not found then
    raise exception 'analysis usage event is not active';
  end if;

  insert into public.analysis_history (user_id, question, cache_key, result_json, created_at)
  values (
    p_user_id,
    p_question,
    p_cache_key,
    p_result_json,
    coalesce(p_result_created_at, v_now)
  )
  returning id, created_at into v_history_id, v_history_created_at;

  update public.analysis_usage_events
  set
    status = 'completed',
    completed_at = v_now,
    lease_expires_at = null,
    metric = p_metric,
    aggregation = p_aggregation,
    match_count = p_match_count,
    provider = p_provider,
    cache_status = p_cache_status,
    cache_hit_count = p_cache_hit_count,
    cache_miss_count = p_cache_miss_count,
    duration_ms = p_duration_ms,
    error_code = null,
    analysis_history_id = v_history_id
  where id = p_usage_event_id
    and user_id = p_user_id;

  return query select v_history_id, v_history_created_at;
end;
$$;

create or replace function public.fail_analysis_usage(
  p_user_id uuid,
  p_usage_event_id uuid,
  p_status text,
  p_error_code text,
  p_provider text,
  p_cache_status text,
  p_cache_hit_count integer,
  p_cache_miss_count integer,
  p_duration_ms integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('failed_user', 'failed_provider', 'failed_internal') then
    raise exception 'invalid terminal usage status';
  end if;
  if p_cache_status not in ('hit', 'miss', 'mixed', 'unknown') then
    raise exception 'invalid cache status';
  end if;
  if p_cache_hit_count < 0 or p_cache_miss_count < 0 or p_duration_ms < 0 then
    raise exception 'invalid analysis telemetry';
  end if;

  update public.analysis_usage_events
  set
    status = p_status,
    completed_at = clock_timestamp(),
    lease_expires_at = null,
    provider = p_provider,
    cache_status = p_cache_status,
    cache_hit_count = p_cache_hit_count,
    cache_miss_count = p_cache_miss_count,
    duration_ms = p_duration_ms,
    error_code = p_error_code
  where id = p_usage_event_id
    and user_id = p_user_id
    and status = 'started';

  return found;
end;
$$;

revoke all on function public.begin_analysis_usage(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.begin_analysis_usage(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer)
  to service_role;

revoke all on function public.complete_analysis_usage(uuid, uuid, text, text, jsonb, timestamptz, text, text, integer, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.complete_analysis_usage(uuid, uuid, text, text, jsonb, timestamptz, text, text, integer, text, text, integer, integer, integer)
  to service_role;

revoke all on function public.fail_analysis_usage(uuid, uuid, text, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.fail_analysis_usage(uuid, uuid, text, text, text, text, integer, integer, integer)
  to service_role;

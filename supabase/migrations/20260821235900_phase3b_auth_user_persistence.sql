-- Phase 3B: Supabase Auth-backed user persistence.
-- Sports cache from Phase 3A remains server-side and separate.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analysis_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  cache_key text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists analysis_history_user_created_idx
  on public.analysis_history (user_id, created_at desc);

create table if not exists public.saved_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_history_id uuid,
  cache_key text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, cache_key),
  foreign key (analysis_history_id, user_id)
    references public.analysis_history (id, user_id)
    on delete set null
);

create index if not exists saved_analyses_user_created_idx
  on public.saved_analyses (user_id, created_at desc);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists workspaces_user_updated_idx
  on public.workspaces (user_id, updated_at desc);

create table if not exists public.workspace_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_history_id uuid,
  cache_key text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, cache_key),
  foreign key (workspace_id, user_id)
    references public.workspaces (id, user_id)
    on delete cascade,
  foreign key (analysis_history_id, user_id)
    references public.analysis_history (id, user_id)
    on delete set null
);

create index if not exists workspace_items_user_workspace_idx
  on public.workspace_items (user_id, workspace_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.analysis_history enable row level security;
alter table public.saved_analyses enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_items enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.analysis_history from anon, authenticated;
revoke all on table public.saved_analyses from anon, authenticated;
revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_items from anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.analysis_history to authenticated;
grant select, insert, update, delete on table public.saved_analyses to authenticated;
grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_items to authenticated;

grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.analysis_history to service_role;
grant select, insert, update, delete on table public.saved_analyses to service_role;
grant select, insert, update, delete on table public.workspaces to service_role;
grant select, insert, update, delete on table public.workspace_items to service_role;

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy profiles_delete_own
  on public.profiles for delete
  to authenticated
  using ((select auth.uid()) = id);

create policy analysis_history_select_own
  on public.analysis_history for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy analysis_history_insert_own
  on public.analysis_history for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy analysis_history_update_own
  on public.analysis_history for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy analysis_history_delete_own
  on public.analysis_history for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy saved_analyses_select_own
  on public.saved_analyses for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy saved_analyses_insert_own
  on public.saved_analyses for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy saved_analyses_update_own
  on public.saved_analyses for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy saved_analyses_delete_own
  on public.saved_analyses for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy workspaces_select_own
  on public.workspaces for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy workspaces_insert_own
  on public.workspaces for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy workspaces_update_own
  on public.workspaces for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy workspaces_delete_own
  on public.workspaces for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy workspace_items_select_own
  on public.workspace_items for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy workspace_items_insert_own
  on public.workspace_items for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy workspace_items_update_own
  on public.workspace_items for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy workspace_items_delete_own
  on public.workspace_items for delete
  to authenticated
  using ((select auth.uid()) = user_id);

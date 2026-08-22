-- Phase 3B hardening: covering indexes for user-persistence foreign keys.
create index if not exists saved_analyses_history_owner_idx
  on public.saved_analyses (analysis_history_id, user_id);

create index if not exists workspace_items_history_owner_idx
  on public.workspace_items (analysis_history_id, user_id);

create index if not exists workspace_items_workspace_owner_idx
  on public.workspace_items (workspace_id, user_id);

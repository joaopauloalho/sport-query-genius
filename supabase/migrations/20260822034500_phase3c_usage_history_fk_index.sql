-- Phase 3C advisor follow-up: cover the history FK used by ON DELETE SET NULL.
create index if not exists analysis_usage_history_idx
  on public.analysis_usage_events (analysis_history_id)
  where analysis_history_id is not null;

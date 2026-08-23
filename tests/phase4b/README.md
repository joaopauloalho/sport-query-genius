# Phase 4B validation

This suite validates the first universal football executors without network access.

It covers QueryPlan normalization, chronological team incidents, provider contract mapping, exact match-list windows, upcoming schedules, deterministic head-to-head summaries, capability-aware fallback, incomplete-coverage handling (`null` is never treated as zero), and the provider payload-cache migration.

Provider facts remain outside the language model: DeepSeek produces only a validated QueryPlan, while all sports data and calculations are provider-derived and deterministic.

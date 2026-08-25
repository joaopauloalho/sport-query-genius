# Phase 5C — Universal Player Stats Capability Matrix

This document describes the deterministic capability surface implemented by Phase 5C. It is intentionally conservative: a metric being present in a provider payload or catalog does not by itself make a query executable.

## Truth rules

- `0` is an observed value when the provider explicitly returns zero.
- missing/null/unmapped values are `UNKNOWN`, never coerced to zero.
- an aggregate or required filter fails closed when its selected sample contains `UNKNOWN` for a required metric.
- `goal_contributions = goals + assists` only when both components are observed.
- `cards = yellow_cards + red_cards` only when both components are observed when no direct observed total is available.
- provider IDs are namespaced. A BSD player ID is never assumed equal to an API-FOOTBALL player ID.
- cross-provider fallback is disabled unless player identity is conservatively reconciled with corroborating evidence.

## Runtime execution

| Capability | Status | Runtime provider | Data family | Notes |
| --- | --- | --- | --- | --- |
| player aggregate | implemented | BSD | `player_match_stats` | generic output metric, filters, scope, grouping, sort and presentation limit |
| player match_list | implemented | BSD | `player_match_stats` | returns the requested observed metric per appearance |
| player goal event_list | retained | BSD | shotmap/incidents legacy path | Phase 3D compatibility path |
| player assist/card event timeline | gated | none | — | aggregate counters do not prove individual event timelines |
| API-FOOTBALL `/fixtures/players` normalization | implemented adapter | API-FOOTBALL | `player_match_stats` | cached and normalized, but not used as cross-provider runtime fallback until identity is proven |
| player comparison | planned/gated | none | — | population/comparison semantics are not part of Phase 5C |
| player ranking/population queries | planned/gated | none | — | no silent downgrade to single-player aggregate |

## Player metric families

The canonical player catalog includes minutes, goals, assists, goal contributions, shooting, rating, passing, key passes, crosses/long balls, duels, dribbles, dispossessions, tackles, interceptions, clearances, recoveries, fouls, cards, xG/xGOT, big chances and goalkeeper metrics.

A metric is executable only when all of the following are true:

1. it is catalogued for the `player` entity;
2. it has a `player_match_stats` mapping;
3. all requested output/filter metrics have a non-empty provider intersection;
4. the runtime has a safely reconciled identity for that provider;
5. the selected appearance sample has complete observed coverage for every required output/filter metric.

Phase 5C runtime deliberately narrows the provider intersection to BSD because BSD player identity is already wired end-to-end. API-FOOTBALL mappings remain truthful metadata/adapter coverage rather than an unsafe fallback promise.

## Scope semantics

Execution order is fixed:

1. resolve player identity;
2. resolve provider-backed competition/season when requested;
3. apply structural scope (`venue`, `competition`, dates, opponent, finished status);
4. retain real player appearances only;
5. apply `last_matches` as the last N real appearances;
6. require metric coverage for output and filters;
7. apply metric filters with AND semantics;
8. group, when requested;
9. aggregate;
10. sort grouped results;
11. apply presentation `limit`.

`last_matches` never means the last N team fixtures and is never reused as a result-row limit.

## Cache

Phase 5C reuses the existing generic `sports_provider_payload_cache` JSONB cache and introduces no database migration.

- family: `player_match_stats`
- BSD raw key: provider/player/family payload
- BSD normalized snapshot key: player-level normalized snapshot bundle
- API-FOOTBALL key: fixture-level `/fixtures/players` payload
- one normalized snapshot can serve multiple output/filter metrics without one provider request per metric

The historical narrow player cache remains a compatibility surface; Phase 5C does not expand it into dozens of metric columns.

## Fail-closed examples

The following must not produce an invented numeric answer:

- a player-only query using a team-only metric;
- a required metric missing in one selected appearance;
- a metric filter whose value is unknown in one selected appearance;
- `percentage`/`rate` without an explicit denominator semantic;
- first/second-half player stats without proven half coverage;
- live/upcoming player stats without a proven runtime family;
- cross-provider fallback with unresolved player identity;
- assist/card `event_list` inferred only from aggregate counters.

## Validation gates

Phase 5C is protected by:

- focused `tests/phase5c` normalization/execution/provider tests;
- all prior regression suites;
- the unchanged 719-case Phase 5B Genius corpus;
- an additional 216-case Phase 5C player Genius corpus;
- typecheck;
- lint over the immutable Phase 5C truth surface;
- production build;
- server-secret client-bundle scan.

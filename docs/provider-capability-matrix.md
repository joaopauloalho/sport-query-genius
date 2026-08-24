# Football provider capability matrix

Validated against the provider documentation on 2026-08-24. This document records data capabilities; it does not imply that every catalogued field is executable by the product.

| Capability | BSD | API-Football | Engine status |
| --- | --- | --- | --- |
| Fixture scores / team fixtures | `/events/` | `/fixtures` | Implemented, provider-backed, cached |
| Fixture statistics | `/events/{event_id}/stats/` | `/fixtures/statistics` | Implemented for validated raw subset; broader catalog remains gated |
| Incidents / events | `/events/{event_id}/incidents/` | `/fixtures/events` | Implemented for team event list |
| Player match statistics | player stats + event player stats | player/fixture statistics documented | BSD path implemented for current player executor |
| Shotmap / per-shot detail | event stats shotmap | not required by current fallback | BSD goal enrichment implemented |
| Standings | league standings by real `season_id` | `/standings` | Registered; execution still gated |
| Lineups | event lineups | `/fixtures/lineups` | Registered; execution still gated |
| Squads | team squad | `/players/squads` | Registered; execution still gated |
| Head-to-head | provider H2H available; current engine derives from fixtures | fixtures/H2H available | Implemented deterministically from reconciled fixture history |
| Competition seasons | `/leagues/{id}/seasons/` and `/leagues/{id}/season/` | `/leagues`, including seasons/current/coverage | Canonical model added in Phase 5A; runtime resolver still pending |

## Phase 5A truth policy

The runtime path is now:

`SemanticPlan -> capability negotiation -> ExecutionPlan -> deterministic executor`.

Semantic constraints are preserved before executable validation. A recognized but non-executable filter, group, sort, metric, scope or season fails closed with an explicit unsupported error; it is never converted into a simpler query.

For seasons, the previous calendar-window heuristic is no longer trusted by the Phase 5A gate. BSD explicitly exposes real season identifiers plus start/end/current metadata, and its documentation recommends resolving the current season through the API instead of hardcoding season ids. API-Football exposes competition seasons and coverage through `/leagues`. Until the provider-backed `CompetitionSeasonResolver` is wired into runtime, a season without explicit user date bounds is rejected instead of assuming January-December or July-June.

## Phase 4C data-family policy retained

- `fixture_score`: goals for/against, goal difference, W/D/L, points, win/unbeaten rate, clean sheets, failed to score and both teams scored are derived deterministically from scores.
- `fixture_stats`: validated universal adapter subset is corners, shots, shots on target and cards.
- `incidents`: team event lists stay provider-backed and deterministic.
- `player_match_stats`: current player aggregate/event behavior remains on the existing player executor.

Null is not zero. Aggregate queries require complete metric coverage for the effective sample; otherwise they return `DATA_INSUFFICIENT` rather than estimating missing values.

## Provider references

BSD Football API documentation:
- https://docs.sportdevs.com/
- https://sports.bzzoiro.com/

API-Football / API-Sports documentation:
- https://www.api-football.com/documentation-v3
- https://www.api-football.com/coverage

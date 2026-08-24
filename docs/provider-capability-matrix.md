# Football provider capability matrix

Validated against the provider documentation on 2026-08-23. This document records data capabilities; it does not imply that every catalogued field is already executable by the product.

| Capability | BSD | API-Football | Engine status |
| --- | --- | --- | --- |
| Fixture scores / team fixtures | `/events/`, team fixtures | `/fixtures` | Implemented, provider-backed, cached |
| Fixture statistics | `/events/{event_id}/stats/` | `/fixtures/statistics` | Implemented for the validated raw subset; catalog is broader |
| Incidents / events | `/events/{event_id}/incidents/` | `/fixtures/events` | Implemented for team event list |
| Player match statistics | player stats + event player stats | player/fixture statistics capabilities documented | BSD path implemented for current player executor |
| Shotmap / per-shot detail | event stats shotmap, including per-shot xG when supplied | no equivalent required by current fallback | BSD goal enrichment implemented |
| Standings | league standings by season | `/standings` | Registered; execution still capability-gated |
| Lineups | event lineups | `/fixtures/lineups` | Registered; execution still capability-gated |
| Squads | team squad | `/players/squads` | Registered; execution still capability-gated |
| Head-to-head | provider supports match H2H; current engine can derive from fixtures | H2H/fixtures capability available | Implemented deterministically from reconciled fixture history |

## Phase 4C execution policy

The universal team executor plans the minimum data family before fetching:

- `fixture_score`: `goals_for`, `goals_against`, goal difference, W/D/L, points, win/unbeaten rate, clean sheets, failed to score and both teams scored. These are derived deterministically from the fixture score and never require a statistics endpoint.
- `fixture_stats`: currently validated in the universal adapter for corners, shots, shots on target and cards. Other catalogued metrics remain capability-gated until their provider-field mapping is exercised against real payloads.
- `incidents`: team event lists remain in the Phase 4B executor.
- `player_match_stats`: player aggregate/event behavior remains in the Phase 3D path in this subphase.

Null is not zero. Aggregate queries require complete metric coverage for the effective sample in Phase 4C; otherwise they return `DATA_INSUFFICIENT` with the known/total coverage rather than estimating missing values.

## Provider references

BSD Football API documentation:
- https://docs.sportdevs.com/
- https://sports.bzzoiro.com/

API-Football / API-Sports documentation:
- https://www.api-football.com/documentation-v3
- https://www.api-football.com/coverage

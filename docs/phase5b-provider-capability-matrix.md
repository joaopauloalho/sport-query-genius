# Phase 5B — Fixture Statistics and Competition Season Truth

## Scope

Phase 5B adds one normalized per-fixture/per-team statistics snapshot to the universal football engine. BSD remains the primary provider and API-Football remains a conservative fallback. The executor negotiates the required data families before execution and never invents a statistic, a league ID, a season ID, or a calendar window.

The core invariant is **UNKNOWN != 0**:

- `0` or `0%` explicitly returned by a provider is an observed real value;
- `null`, an absent field, an empty field, or an unsupported field remains UNKNOWN;
- an UNKNOWN value required by a filter fails closed instead of evaluating as zero/false;
- an UNKNOWN value required by an aggregate or requested `match_list` metric fails closed instead of silently shrinking the sample.

## Universal fixture_stats snapshot

`NormalizedTeamFixtureStats` is loaded at most once for each `(provider, fixture, team)` execution and reused for the main metric and every statistics filter:

```text
NormalizedFixtureStatValue
  value       number | null
  observed    boolean
  source      BSD | API-FOOTBALL
  unit        count | % | ...
  rawLabel    provider field that produced the value, or null

FixtureStatsCoverage
  supported   metrics mapped for this provider
  observed    metrics with explicit values (zero included)
  missing     supported metrics whose value is UNKNOWN

NormalizedTeamFixtureStats
  fixtureId
  teamId
  opponentId
  provider
  competitionId
  seasonId
  values
  coverage
  fetchedAt
```

Structural and score-derived filters are evaluated before `fixture_stats` reads. For example, `possession` in matches won first removes non-wins using `fixture_score`, then loads stats only for the surviving fixtures. This both reduces provider reads and avoids duplicating calls.

## Generic filters

The universal team executor supports the generic operators `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, and `in`. Metric and filter metrics may differ, and multiple statistics filters reuse the same snapshot. Structural/score filters and statistics filters can be combined without mixing providers inside one sample.

Examples supported semantically:

- average corners where shots > 10;
- possession where shots_on_target >= 4;
- match list where corners >= 6, with `corners` included in each returned match;
- shots_on_target in matches won (`fixture_score` + `fixture_stats`).

`sort` and `group_by` are rejected for `match_list` while they lack a deterministic implementation. They are not accepted and ignored. Aggregate grouping/sorting remains available where implemented.

## Data-family negotiation

Capability negotiation determines required data families before provider execution:

| Query shape | Families |
| --- | --- |
| score-derived metric only | `fixtures`, `fixture_score` |
| raw fixture statistic only | `fixtures`, `fixture_stats` |
| raw metric + score filter | `fixtures`, `fixture_score`, `fixture_stats` |
| score metric + raw-stat filter | `fixtures`, `fixture_score`, `fixture_stats` |
| provider-backed season | adds `league_season` |

Provider compatibility is intersected across every raw metric used by the query. A BSD-only metric combined with an API-Football-only filter is rejected before execution; it is never satisfied by mixing providers fixture-by-fixture.

## Provider capability matrix

Only mappings validated in the provider adapters/catalog are listed. `conditional` means the provider supports the field/endpoint but individual fixtures may legitimately omit it; omission remains UNKNOWN.

| Metric | BSD field(s) | API-Football field(s) | Provider support | Unit | Coverage / notes |
| --- | --- | --- | --- | --- | --- |
| shots | `total_shots`, `shots_total`; real BSD shotmap may enrich | `Total Shots` | Both | count | core; empty BSD shotmap is not zero |
| shots_on_target | `shots_on_target`, `shots_on_goal`; real BSD shotmap may enrich | `Shots on Goal` | Both | count | core |
| shots_off_target | `shots_off_target` | `Shots off Goal` | Both | count | BSD conditional; API core |
| blocked_shots | `blocked_shots` | `Blocked Shots` | Both | count | BSD conditional; API core |
| shots_inside_box | — | `Shots insidebox` | API-Football | count | conditional |
| shots_outside_box | — | `Shots outsidebox` | API-Football | count | conditional |
| hit_woodwork | `hit_woodwork` | — | BSD | count | conditional |
| big_chances | `big_chances` | — | BSD | count | conditional |
| big_chances_scored | `big_chances_scored` | — | BSD | count | conditional |
| big_chances_missed | `big_chances_missed` | — | BSD | count | conditional |
| xg | `xg` | — | BSD | count | conditional; no API mapping invented |
| offsides | `offsides` | `Offsides` | Both | count | core |
| corners | `corners`, `corner_kicks` | `Corner Kicks` | Both | count | core |
| passes | `passes`, `total_passes` | `Total passes` | Both | count | BSD conditional; API core |
| accurate_passes | `accurate_passes` | `Passes accurate` | Both | count | BSD conditional; API core |
| pass_accuracy | `pass_accuracy` | `Passes %` | Both | % | BSD conditional; API core |
| crosses | `crosses` | — | BSD | count | conditional |
| possession | `ball_possession`, `possession` | `Ball Possession` | Both | % | core |
| duels | `duels` | — | BSD | count | conditional |
| duels_won | `duels_won` | — | BSD | count | conditional |
| dribbles | `dribbles` | — | BSD | count | conditional |
| tackles | `tackles` | — | BSD | count | conditional |
| interceptions | `interceptions` | — | BSD | count | conditional |
| clearances | `clearances` | — | BSD | count | conditional |
| fouls | `fouls` | `Fouls` | Both | count | core |
| yellow_cards | `yellow_cards`, `cards_yellow` | `Yellow Cards` | Both | count | core |
| red_cards | `red_cards`, `cards_red` | `Red Cards` | Both | count | core |
| cards | derived only from observed yellow + red | derived only from observed yellow + red | Both | count | UNKNOWN if either component is UNKNOWN |
| saves | — | `Goalkeeper Saves` | API-Football | count | core; no BSD mapping invented |

Provider endpoints used by the snapshot adapters:

- BSD: `GET /api/v2/events/{eventId}/stats/`
- API-Football: `GET /fixtures/statistics?fixture={fixtureId}`

## Cache

The existing generic provider payload cache is sufficient. `fixture_stats` uses the existing identity `(provider, data_family, cache_key)` with `data_family = fixture_stats`; no Phase 5B-specific table is required. Payload reads are shared inside each source so BSD stats used by goal enrichment and fixture statistics do not require separate external fetches for the same cached payload.

Supabase is an optimization, not a source of invented truth. Provider/cache failures may trigger only the existing conservative provider fallback rules. Missing statistical coverage itself is represented explicitly and fails closed when required.

## Conservative fallback and provenance

BSD remains first. API-Football is attempted only after an eligible provider/data failure (`TEAM_NOT_FOUND`, `PROVIDER_UNAVAILABLE`, `API_LIMIT_REACHED`, or `DATA_INSUFFICIENT`). Semantic errors such as unsupported filters do not trigger fallback.

A successful result exposes, where applicable:

- final provider;
- `providers_attempted`;
- `fallback_occurred`;
- data families/endpoints;
- cache status and latest fetch time;
- fixture-stat coverage (`supported`, observed counts, missing counts);
- resolved competition ID, season ID, and season label.

H2H raw metrics use the same normalized snapshot and include `fixture_stats` in provenance. They do not report only the fixture feed when statistics were actually read.

## Real competition seasons

No rule such as “2025/26 = August 2025 through May 2026” exists in the execution path. There are also no hardcoded league IDs in the competition registry.

For a season-scoped team aggregate, match list, or H2H query:

1. an explicit competition is required;
2. the provider resolves the competition using its live league catalog/search;
3. the provider returns real seasons with IDs, labels, dates, `current`, country, and coverage;
4. `current` is accepted only when exactly one provider season is marked current;
5. `previous` is accepted only relative to that unique real current season;
6. explicit labels such as `2025/26` or `2026` are matched against provider-returned IDs/labels/dates, never used to invent dates;
7. unresolved or ambiguous season truth fails closed.

This accommodates split-year leagues (for example Premier League/Champions League) and calendar-year leagues (for example Brasileirão) using provider truth rather than a shared calendar heuristic.

## Honest limitations

- Per-fixture provider coverage can still be incomplete even for mapped metrics; the engine reports/fails closed rather than filling gaps.
- `xg` is BSD-only and `saves` is API-Football-only in the current verified mapping. Combining incompatible provider-specific metrics is rejected.
- `match_list` deliberately rejects sort/group_by until those operations are implemented without semantic loss.
- Provider season availability and `current` flags are runtime data. If the provider cannot identify them, current/previous season queries are refused.

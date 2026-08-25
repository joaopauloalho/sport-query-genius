import { describe, expect, test } from "bun:test";

import {
  fixtureStatValue,
  mappedFixtureStatMetrics,
  normalizeApiFootballFixtureStats,
  normalizeBsdFixtureStats,
  providerSupportsFixtureStatMetric,
  readFixtureStatNumber,
} from "../../src/server/sports/fixture-stats";
import {
  selectProviderSeason,
  type CompetitionSeason,
} from "../../src/server/sports/competition-season-registry";
import { controlledFixtures, corinthians } from "./helpers";

const item = controlledFixtures[0];

describe("Phase 5B normalized fixture statistics", () => {
  test("explicit numeric zero is observed data", () => {
    expect(readFixtureStatNumber(0)).toEqual({ value: 0, observed: true });
  });

  test("explicit zero percentage is observed data", () => {
    expect(readFixtureStatNumber("0%")).toEqual({ value: 0, observed: true });
  });

  test("null and empty provider values remain UNKNOWN", () => {
    expect(readFixtureStatNumber(null)).toEqual({ value: null, observed: false });
    expect(readFixtureStatNumber("")).toEqual({ value: null, observed: false });
    expect(readFixtureStatNumber("N/A")).toEqual({ value: null, observed: false });
  });

  test("percentage parsing preserves numeric semantics", () => {
    expect(readFixtureStatNumber("64%")).toEqual({ value: 64, observed: true });
  });

  test("BSD snapshot maps proven fields and does not turn missing into zero", () => {
    const result = normalizeBsdFixtureStats(
      {
        stats: {
          home: { total_shots: 0, shots_on_target: 4, corners: null, possession: "61%" },
          away: {},
        },
      },
      item,
      corinthians.id,
      "2026-08-25T12:00:00.000Z",
    );
    expect(fixtureStatValue(result, "shots")).toBe(0);
    expect(result.values.shots?.observed).toBe(true);
    expect(result.values.shots?.rawLabel).toBe("total_shots");
    expect(fixtureStatValue(result, "possession")).toBe(61);
    expect(fixtureStatValue(result, "corners")).toBeNull();
    expect(result.values.corners?.observed).toBe(false);
    expect(result.coverage.missing).toContain("corners");
  });

  test("BSD empty shotmap does not synthesize zero shots", () => {
    const result = normalizeBsdFixtureStats(
      { stats: { home: {}, away: {} }, shotmap: [] },
      item,
      corinthians.id,
    );
    expect(fixtureStatValue(result, "shots")).toBeNull();
    expect(result.values.shots?.observed).toBe(false);
  });

  test("API-Football snapshot preserves 0%, zero counts and nulls", () => {
    const result = normalizeApiFootballFixtureStats(
      {
        response: [
          {
            team: { id: corinthians.id },
            statistics: [
              { type: "Ball Possession", value: "0%" },
              { type: "Corner Kicks", value: 0 },
              { type: "Total Shots", value: null },
              { type: "Goalkeeper Saves", value: 5 },
            ],
          },
        ],
      },
      item,
      corinthians.id,
    );
    expect(fixtureStatValue(result, "possession")).toBe(0);
    expect(fixtureStatValue(result, "corners")).toBe(0);
    expect(fixtureStatValue(result, "shots")).toBeNull();
    expect(fixtureStatValue(result, "saves")).toBe(5);
  });

  test("provider capability matrix remains conservative and provider-specific", () => {
    expect(providerSupportsFixtureStatMetric("BSD", "xg")).toBe(true);
    expect(providerSupportsFixtureStatMetric("API-FOOTBALL", "xg")).toBe(false);
    expect(providerSupportsFixtureStatMetric("API-FOOTBALL", "saves")).toBe(true);
    expect(providerSupportsFixtureStatMetric("BSD", "saves")).toBe(false);
    expect(mappedFixtureStatMetrics("BSD")).toContain("corners");
    expect(mappedFixtureStatMetrics("API-FOOTBALL")).toContain("corners");
  });

  test("cards is derived only when yellow and red are both observed", () => {
    const complete = normalizeBsdFixtureStats(
      { stats: { home: { yellow_cards: 2, red_cards: 0 }, away: {} } },
      item,
      corinthians.id,
    );
    expect(fixtureStatValue(complete, "cards")).toBe(2);
    const incomplete = normalizeBsdFixtureStats(
      { stats: { home: { yellow_cards: 2, red_cards: null }, away: {} } },
      item,
      corinthians.id,
    );
    expect(fixtureStatValue(incomplete, "cards")).toBeNull();
  });
});

describe("Phase 5B provider-backed CompetitionSeason", () => {
  const seasons: CompetitionSeason[] = [
    {
      provider: "BSD",
      competitionId: "9",
      seasonId: "2024",
      label: "2024/25",
      startDate: "2024-08-15",
      endDate: "2025-05-31",
      current: false,
      country: "England",
      coverage: { statistics_fixtures: true },
      competition: "Premier League",
    },
    {
      provider: "BSD",
      competitionId: "9",
      seasonId: "2025",
      label: "2025/26",
      startDate: "2025-08-15",
      endDate: "2026-05-31",
      current: true,
      country: "England",
      coverage: { statistics_fixtures: true },
      competition: "Premier League",
    },
  ];

  test("current resolves only from provider current=true", () => {
    expect(selectProviderSeason(seasons, "current")?.seasonId).toBe("2025");
  });

  test("previous is relative to the unique real current season", () => {
    expect(selectProviderSeason(seasons, "previous")?.seasonId).toBe("2024");
  });

  test("split-year label matches provider dates/label without inferring a window", () => {
    expect(selectProviderSeason(seasons, "2025/26")?.seasonId).toBe("2025");
  });

  test("calendar-year season can be represented by provider real dates", () => {
    const brazil: CompetitionSeason[] = [
      {
        provider: "API-FOOTBALL",
        competitionId: "71",
        seasonId: "2026",
        label: "2026",
        startDate: "2026-01-28",
        endDate: "2026-12-06",
        current: true,
        country: "Brazil",
        coverage: { statistics_fixtures: true },
        competition: "Brasileirão Série A",
      },
    ];
    expect(selectProviderSeason(brazil, "2026")?.startDate).toBe("2026-01-28");
  });

  test("previous fails closed when provider has no identifiable current season", () => {
    const noCurrent = seasons.map((season) => ({ ...season, current: false }));
    expect(selectProviderSeason(noCurrent, "previous")).toBeNull();
  });

  test("ambiguous current fails closed", () => {
    expect(
      selectProviderSeason(
        seasons.map((season) => ({ ...season, current: true })),
        "current",
      ),
    ).toBeNull();
  });
});

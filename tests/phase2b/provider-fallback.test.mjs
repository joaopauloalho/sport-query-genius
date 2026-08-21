import assert from "node:assert/strict";
import test from "node:test";

import { AnalysisPipelineError } from "../../src/server/analysis/errors.ts";
import { applyOverrides } from "../../src/server/analysis/overrides.ts";
import {
  FootballProviderOrchestrator,
  matchCrossProviderFixture,
} from "../../src/server/sports/provider-fallback.server.ts";
import { fixtureMatchesFilters } from "../../src/server/sports/provider.ts";
import { classifyApiFootballError } from "../../src/server/sports/providers/api-football-errors.ts";

const CORINTHIANS_BSD = { id: 200, name: "Corinthians", country: "Brasil" };
const CORINTHIANS_API = { id: 400, name: "Corinthians", country: "Brazil" };
const CASCAVEL_BSD = { id: 100, name: "Cascavel" };
const CASCAVEL_API = { id: 300, name: "Cascavel" };

function fixture({
  id,
  date,
  competition = "Brasileirão Série A",
  home = { id: CORINTHIANS_BSD.id, name: CORINTHIANS_BSD.name },
  away = { id: 999, name: "Palmeiras" },
  homeGoals = 1,
  awayGoals = 0,
}) {
  return {
    id,
    date,
    timestamp: Math.floor(Date.parse(date) / 1000),
    status: "finished",
    competition,
    home,
    away,
    goals: { home: homeGoals, away: awayGoals },
  };
}

function matchRecord(providerName, targetFixture, teamId, value) {
  const isHome = targetFixture.home.id === teamId;
  const isAway = targetFixture.away.id === teamId;
  if (!isHome && !isAway) return null;

  const goalsFor = isHome ? targetFixture.goals.home : targetFixture.goals.away;
  const goalsAgainst = isHome ? targetFixture.goals.away : targetFixture.goals.home;
  if (goalsFor === null || goalsAgainst === null) return null;

  return {
    id: String(targetFixture.id),
    date: targetFixture.date,
    opponent: isHome ? targetFixture.away.name : targetFixture.home.name,
    competition: targetFixture.competition,
    venue: isHome ? "home" : "away",
    result: `${targetFixture.goals.home}-${targetFixture.goals.away}`,
    outcome: goalsFor > goalsAgainst ? "V" : goalsFor < goalsAgainst ? "D" : "E",
    value,
    source: providerName,
  };
}

class FakeProvider {
  constructor({
    name,
    team,
    fixtures = [],
    metrics = new Map(),
    resolveError = null,
    fixturesError = null,
    applyFilters = false,
  }) {
    this.name = name;
    this.team = team;
    this.fixtures = fixtures;
    this.metrics = metrics;
    this.resolveError = resolveError;
    this.fixturesError = fixturesError;
    this.applyFilters = applyFilters;
    this.calls = { resolve: 0, fixtures: [], metrics: [] };
  }

  async resolveTeam() {
    this.calls.resolve += 1;
    if (this.resolveError) throw this.resolveError;
    return this.team;
  }

  async getRecentTeamFixtures(teamId, count, filters) {
    this.calls.fixtures.push({ teamId, count, filters });
    if (this.fixturesError) throw this.fixturesError;
    const source = this.applyFilters
      ? this.fixtures.filter((item) => fixtureMatchesFilters(item, teamId, filters))
      : this.fixtures;
    return source.slice(-count);
  }

  async getFixtureMetric(targetFixture, teamId) {
    this.calls.metrics.push(targetFixture.id);
    const configured = this.metrics.get(targetFixture.id);
    if (configured instanceof Error) throw configured;
    if (configured === null || configured === undefined) return null;
    return matchRecord(this.name, targetFixture, teamId, configured);
  }
}

function fiveBsdFixtures() {
  return [
    fixture({ id: 101, date: "2026-08-01T18:00:00.000Z" }),
    fixture({ id: 102, date: "2026-08-05T18:00:00.000Z", away: { id: 998, name: "Santos" } }),
    fixture({ id: 103, date: "2026-08-09T18:00:00.000Z", away: { id: 997, name: "Grêmio" } }),
    fixture({ id: 104, date: "2026-08-13T18:00:00.000Z", away: { id: 996, name: "Bahia" } }),
    fixture({ id: 105, date: "2026-08-17T18:00:00.000Z", away: { id: 995, name: "Flamengo" } }),
  ];
}

const cascavelBsd = fixture({
  id: 216683,
  date: "2026-07-12T18:00:00.000Z",
  competition: "Club Friendlies",
  home: CASCAVEL_BSD,
  away: { id: CORINTHIANS_BSD.id, name: CORINTHIANS_BSD.name },
  homeGoals: 0,
  awayGoals: 1,
});

const cascavelApi = fixture({
  id: 900001,
  date: "2026-07-12T18:30:00.000Z",
  competition: "Friendlies Clubs",
  home: CASCAVEL_API,
  away: { id: CORINTHIANS_API.id, name: CORINTHIANS_API.name },
  homeGoals: 0,
  awayGoals: 1,
});

test("A. BSD completo não chama API-Football", async () => {
  const fixtures = fiveBsdFixtures();
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    fixtures,
    metrics: new Map(fixtures.map((item, index) => [item.id, index + 2])),
  });
  const api = new FakeProvider({ name: "API-FOOTBALL", team: CORINTHIANS_API });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);

  const selection = await orchestrator.selectTeamFixtures("Corinthians", 5);
  const matches = await orchestrator.getSelectedFixtureMetrics(selection, "corners");

  assert.equal(selection.provider.name, "BSD");
  assert.equal(matches.length, 5);
  assert.deepEqual(new Set(matches.map((item) => item.source)), new Set(["BSD"]));
  assert.equal(api.calls.resolve, 0);
  assert.equal(api.calls.fixtures.length, 0);
  assert.equal(api.calls.metrics.length, 0);
});

test("B. BSD indisponível antes de resolver o time aciona API-Football", async () => {
  const apiFixtures = [
    fixture({
      id: 501,
      date: "2026-08-17T18:00:00.000Z",
      home: { id: CORINTHIANS_API.id, name: CORINTHIANS_API.name },
    }),
  ];
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    resolveError: new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "BSD timeout de teste",
    ),
  });
  const api = new FakeProvider({
    name: "API-FOOTBALL",
    team: CORINTHIANS_API,
    fixtures: apiFixtures,
    metrics: new Map([[501, 7]]),
  });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);

  const selection = await orchestrator.selectTeamFixtures("Corinthians", 1);
  const matches = await orchestrator.getSelectedFixtureMetrics(selection, "corners");

  assert.equal(selection.usedFallbackForSelection, true);
  assert.equal(selection.provider.name, "API-FOOTBALL");
  assert.equal(api.calls.resolve, 1);
  assert.equal(matches[0].source, "API-FOOTBALL");
});

test("B2. TEAM_NOT_FOUND no BSD também avalia API-Football", async () => {
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    resolveError: new AnalysisPipelineError("TEAM_NOT_FOUND", "não encontrado no BSD"),
  });
  const api = new FakeProvider({
    name: "API-FOOTBALL",
    team: CORINTHIANS_API,
    fixtures: [
      fixture({
        id: 502,
        date: "2026-08-18T18:00:00.000Z",
        home: { id: CORINTHIANS_API.id, name: CORINTHIANS_API.name },
      }),
    ],
  });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);

  const selection = await orchestrator.selectTeamFixtures("Corinthians", 1);
  assert.equal(selection.provider.name, "API-FOOTBALL");
  assert.equal(api.calls.resolve, 1);
});

test("C. uma métrica BSD ausente gera fallback somente para a fixture ausente", async () => {
  const selected = [
    cascavelBsd,
    fixture({ id: 217001, date: "2026-07-16T18:00:00.000Z" }),
    fixture({ id: 217002, date: "2026-07-20T18:00:00.000Z" }),
    fixture({ id: 217003, date: "2026-07-24T18:00:00.000Z" }),
    fixture({ id: 217004, date: "2026-07-28T18:00:00.000Z" }),
  ];
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    fixtures: selected,
    metrics: new Map([
      [216683, null],
      [217001, 3],
      [217002, 5],
      [217003, 4],
      [217004, 6],
    ]),
  });
  const olderWrongFixture = fixture({
    id: 899999,
    date: "2026-06-01T18:00:00.000Z",
    home: { id: CORINTHIANS_API.id, name: CORINTHIANS_API.name },
    away: { id: 888, name: "Outro adversário" },
  });
  const api = new FakeProvider({
    name: "API-FOOTBALL",
    team: CORINTHIANS_API,
    fixtures: [olderWrongFixture, cascavelApi],
    metrics: new Map([
      [899999, 99],
      [900001, 8],
    ]),
  });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);

  const selection = await orchestrator.selectTeamFixtures("Corinthians", 5);
  const matches = await orchestrator.getSelectedFixtureMetrics(selection, "corners");

  assert.equal(matches.length, 5);
  assert.equal(matches[0].value, 8);
  assert.equal(matches[0].source, "API-FOOTBALL");
  assert.deepEqual(api.calls.metrics, [900001]);
  assert.equal(api.calls.fixtures.length, 1);
  assert.equal(api.calls.fixtures[0].count, 120);
});

test("D. matching cross-provider exato aceita a mesma partida com IDs diferentes", () => {
  const match = matchCrossProviderFixture(cascavelBsd, [cascavelApi]);
  assert.equal(match.status, "matched");
  assert.equal(match.fixture.id, 900001);
});

test("E. matching ambíguo retorna DATA_INSUFFICIENT e não escolhe candidato", async () => {
  const ambiguousA = { ...cascavelApi, id: 900011, competition: "Club Friendlies" };
  const ambiguousB = {
    ...cascavelApi,
    id: 900012,
    date: "2026-07-12T19:00:00.000Z",
    timestamp: Math.floor(Date.parse("2026-07-12T19:00:00.000Z") / 1000),
    competition: "Club Friendlies",
  };
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    fixtures: [cascavelBsd],
    metrics: new Map([[216683, null]]),
  });
  const api = new FakeProvider({
    name: "API-FOOTBALL",
    team: CORINTHIANS_API,
    fixtures: [ambiguousA, ambiguousB],
    metrics: new Map([
      [900011, 8],
      [900012, 9],
    ]),
  });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);
  const selection = await orchestrator.selectTeamFixtures("Corinthians", 1);

  await assert.rejects(
    () => orchestrator.getSelectedFixtureMetrics(selection, "corners"),
    (error) => error instanceof AnalysisPipelineError && error.code === "DATA_INSUFFICIENT",
  );
  assert.deepEqual(api.calls.metrics, []);
});

test("F. nenhum provider possui a métrica mantém DATA_INSUFFICIENT", async () => {
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    fixtures: [cascavelBsd],
    metrics: new Map([[216683, null]]),
  });
  const api = new FakeProvider({
    name: "API-FOOTBALL",
    team: CORINTHIANS_API,
    fixtures: [cascavelApi],
    metrics: new Map([[900001, null]]),
  });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);
  const selection = await orchestrator.selectTeamFixtures("Corinthians", 1);

  await assert.rejects(
    () => orchestrator.getSelectedFixtureMetrics(selection, "corners"),
    (error) => error instanceof AnalysisPipelineError && error.code === "DATA_INSUFFICIENT",
  );
  assert.deepEqual(api.calls.metrics, [900001]);
});

test("G. API-Football suspenso e entitlement são classificados sem esconder a causa", () => {
  assert.equal(
    classifyApiFootballError({ account: "Your account is suspended" }),
    "account",
  );
  assert.equal(
    classifyApiFootballError({ subscription: "This endpoint is not included in your plan" }),
    "plan",
  );
});

test("H. competição e mando continuam restringindo as fixtures antes da amostra", async () => {
  const fixtures = [
    fixture({ id: 601, date: "2026-08-01T18:00:00.000Z", competition: "Brasileirao Serie A" }),
    fixture({
      id: 602,
      date: "2026-08-05T18:00:00.000Z",
      competition: "Brasileirão Série A",
      home: { id: 777, name: "Palmeiras" },
      away: { id: CORINTHIANS_BSD.id, name: CORINTHIANS_BSD.name },
    }),
    fixture({ id: 603, date: "2026-08-09T18:00:00.000Z", competition: "Copa do Brasil" }),
  ];
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    fixtures,
    applyFilters: true,
  });
  const api = new FakeProvider({ name: "API-FOOTBALL", team: CORINTHIANS_API });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);

  const selection = await orchestrator.selectTeamFixtures("Corinthians", 5, {
    venue: "away",
    competitionNames: ["Brasileirão Série A"],
  });

  assert.deepEqual(selection.fixtures.map((item) => item.id), [602]);
  assert.equal(api.calls.resolve, 0);
});

test("I. override explícito da UI continua prevalecendo sobre DeepSeek", () => {
  const parsed = {
    sport: "football",
    entity_type: "team",
    entity_name: "Corinthians",
    metric: "corners",
    aggregation: "average",
    match_count: 10,
    competition: "ucl",
    venue: "home",
  };

  const effective = applyOverrides(parsed, {
    match_count: 20,
    competition: "brasileirao",
    venue: "away",
  });

  assert.equal(effective.match_count, 20);
  assert.equal(effective.competition, "brasileirao");
  assert.equal(effective.venue, "away");
});

test("J. estatística ausente nunca é inventada nem substituída por partida anterior", async () => {
  const oldApiFixture = fixture({
    id: 880000,
    date: "2026-06-20T18:00:00.000Z",
    home: { id: CORINTHIANS_API.id, name: CORINTHIANS_API.name },
    away: { id: 881, name: "Adversário antigo" },
  });
  const bsd = new FakeProvider({
    name: "BSD",
    team: CORINTHIANS_BSD,
    fixtures: [cascavelBsd],
    metrics: new Map([[216683, null]]),
  });
  const api = new FakeProvider({
    name: "API-FOOTBALL",
    team: CORINTHIANS_API,
    fixtures: [oldApiFixture],
    metrics: new Map([[880000, 42]]),
  });
  const orchestrator = new FootballProviderOrchestrator(bsd, api);
  const selection = await orchestrator.selectTeamFixtures("Corinthians", 1);

  await assert.rejects(
    () => orchestrator.getSelectedFixtureMetrics(selection, "corners"),
    (error) => {
      assert.equal(error.code, "DATA_INSUFFICIENT");
      assert.match(error.message, /nenhuma partida anterior foi usada/i);
      assert.match(error.message, /nenhum valor foi estimado/i);
      return true;
    },
  );
  assert.deepEqual(api.calls.metrics, []);
});

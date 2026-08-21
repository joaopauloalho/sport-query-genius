import assert from "node:assert/strict";
import test from "node:test";

import { CachedSportsDataProvider } from "../../src/server/sports/cache/cached-provider.server.ts";
import { normalizeCacheName } from "../../src/server/sports/cache/cache-policy.ts";
import { FilteredSportsDataProvider } from "../../src/server/sports/filtered-provider.server.ts";
import { FootballProviderOrchestrator } from "../../src/server/sports/provider-fallback.server.ts";

const NOW = Date.parse("2026-08-21T18:00:00.000Z");
const TEAM_BSD = { id: 200, name: "Corinthians", country: "Brasil" };
const TEAM_API = { id: 400, name: "Corinthians", country: "Brazil" };

function fixture({
  id,
  date = "2026-08-01T18:00:00.000Z",
  competition = "Brasileirão Série A",
  home = { id: TEAM_BSD.id, name: TEAM_BSD.name },
  away = { id: 999, name: "Palmeiras" },
  homeGoals = 1,
  awayGoals = 0,
  status = "finished",
}) {
  return {
    id,
    date,
    timestamp: Math.floor(Date.parse(date) / 1000),
    status,
    competition,
    home,
    away,
    goals: { home: homeGoals, away: awayGoals },
  };
}

function record(providerName, targetFixture, teamId, value) {
  if (value === null) return null;
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
  constructor({ name, team, fixtures, metrics }) {
    this.name = name;
    this.team = team;
    this.fixtures = fixtures;
    this.metrics = metrics;
    this.calls = { resolve: 0, fixtures: 0, metrics: 0 };
  }

  async resolveTeam() {
    this.calls.resolve += 1;
    return this.team;
  }

  async getRecentTeamFixtures(_teamId, count) {
    this.calls.fixtures += 1;
    return this.fixtures.slice(-count);
  }

  async getFixtureMetric(targetFixture, teamId) {
    this.calls.metrics += 1;
    return record(this.name, targetFixture, teamId, this.metrics.get(targetFixture.id) ?? null);
  }
}

class MemorySportsCacheRepository {
  constructor(now = () => NOW) {
    this.now = now;
    this.teams = new Map();
    this.fixtures = new Map();
    this.metrics = new Map();
  }

  teamKey(provider, teamId) {
    return `${provider}:${teamId}`;
  }

  fixtureKey(provider, fixtureId) {
    return `${provider}:${fixtureId}`;
  }

  metricKey(provider, fixtureId, teamId, metric) {
    return `${provider}:${fixtureId}:${teamId}:${metric}`;
  }

  async getTeamByNormalizedName(provider, normalizedName) {
    return (
      [...this.teams.values()].find(
        (team) => team.provider === provider && normalizeCacheName(team.name) === normalizedName,
      ) ?? null
    );
  }

  async getTeamById(provider, teamId) {
    return this.teams.get(this.teamKey(provider, teamId)) ?? null;
  }

  async upsertTeam(provider, team) {
    const key = this.teamKey(provider, team.id);
    const existing = this.teams.get(key);
    this.teams.set(key, {
      provider,
      id: team.id,
      name: team.name,
      country: team.country,
      fetchedAt: new Date(this.now()).toISOString(),
      fixturesFetchedAt: existing?.fixturesFetchedAt ?? null,
      fixturesRequestedCount: existing?.fixturesRequestedCount ?? 0,
      fixturesReturnedCount: existing?.fixturesReturnedCount ?? 0,
    });
  }

  async listRecentFixtures(provider, teamId, limit) {
    return [...this.fixtures.values()]
      .filter(
        (item) =>
          item.provider === provider &&
          (item.fixture.home.id === teamId || item.fixture.away.id === teamId),
      )
      .map((item) => item.fixture)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit);
  }

  async upsertFixtures(provider, fixtures) {
    for (const targetFixture of fixtures) {
      this.fixtures.set(this.fixtureKey(provider, targetFixture.id), {
        provider,
        fixture: structuredClone(targetFixture),
      });
    }
  }

  async markFixturesFetched(provider, teamId, requestedCount, returnedCount) {
    const key = this.teamKey(provider, teamId);
    const team = this.teams.get(key);
    if (!team) return;
    this.teams.set(key, {
      ...team,
      fixturesFetchedAt: new Date(this.now()).toISOString(),
      fixturesRequestedCount: requestedCount,
      fixturesReturnedCount: returnedCount,
    });
  }

  async getMetric(provider, fixtureId, teamId, metric) {
    return this.metrics.get(this.metricKey(provider, fixtureId, teamId, metric)) ?? null;
  }

  async upsertMetric({ provider, fixtureId, teamId, metric, value, sourceProvider }) {
    this.metrics.set(this.metricKey(provider, fixtureId, teamId, metric), {
      value,
      sourceProvider,
      fetchedAt: new Date(this.now()).toISOString(),
    });
  }

  setMetricFetchedAt(provider, fixtureId, teamId, metric, fetchedAt) {
    const key = this.metricKey(provider, fixtureId, teamId, metric);
    this.metrics.set(key, { ...this.metrics.get(key), fetchedAt });
  }
}

class MetricWriteFailingRepository extends MemorySportsCacheRepository {
  async upsertMetric() {
    throw new Error("simulated Supabase write failure");
  }
}

async function loadSample(provider, repository, count = 2) {
  const cached = new CachedSportsDataProvider(provider, repository, () => NOW);
  const team = await cached.resolveTeam("Corinthians");
  const fixtures = await cached.getRecentTeamFixtures(team.id, count);
  const matches = await Promise.all(
    fixtures.map((targetFixture) => cached.getFixtureMetric(targetFixture, team.id, "corners")),
  );
  return matches;
}

function basicFixtures() {
  return [
    fixture({ id: 101, date: "2026-08-01T18:00:00.000Z" }),
    fixture({ id: 102, date: "2026-08-05T18:00:00.000Z", away: { id: 998, name: "Santos" } }),
  ];
}

test("A. primeira busca em cache vazio chama provider e persiste fixtures/métricas", async () => {
  const fixtures = basicFixtures();
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures,
    metrics: new Map([
      [101, 4],
      [102, 6],
    ]),
  });
  const repository = new MemorySportsCacheRepository();

  const matches = await loadSample(provider, repository);

  assert.deepEqual(
    matches.map((item) => item?.value),
    [4, 6],
  );
  assert.deepEqual(provider.calls, { resolve: 1, fixtures: 1, metrics: 2 });
  assert.equal(repository.fixtures.size, 2);
  assert.equal(repository.metrics.size, 2);
});

test("B. segunda busca idêntica usa cache e não chama provider novamente", async () => {
  const fixtures = basicFixtures();
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures,
    metrics: new Map([
      [101, 4],
      [102, 6],
    ]),
  });
  const repository = new MemorySportsCacheRepository();

  await loadSample(provider, repository);
  const callsAfterFirst = structuredClone(provider.calls);
  const second = await loadSample(provider, repository);

  assert.deepEqual(
    second.map((item) => item?.value),
    [4, 6],
  );
  assert.deepEqual(provider.calls, callsAfterFirst);
});

test("C. pergunta diferente average -> total reutiliza as mesmas fixtures e só recalcula", async () => {
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures: basicFixtures(),
    metrics: new Map([
      [101, 4],
      [102, 6],
    ]),
  });
  const repository = new MemorySportsCacheRepository();

  const first = await loadSample(provider, repository);
  const average = first.reduce((sum, item) => sum + item.value, 0) / first.length;
  const callsAfterAverage = structuredClone(provider.calls);
  const second = await loadSample(provider, repository);
  const total = second.reduce((sum, item) => sum + item.value, 0);

  assert.equal(average, 5);
  assert.equal(total, 10);
  assert.deepEqual(provider.calls, callsAfterAverage);
});

test("D. valor real zero permanece 0 e é reutilizado", async () => {
  const targetFixture = fixture({ id: 201 });
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures: [targetFixture],
    metrics: new Map([[201, 0]]),
  });
  const repository = new MemorySportsCacheRepository();

  const first = await loadSample(provider, repository, 1);
  const second = await loadSample(provider, repository, 1);

  assert.equal(first[0].value, 0);
  assert.equal(second[0].value, 0);
  assert.equal(provider.calls.metrics, 1);
});

test("E. valor null permanece ausente e nunca é convertido em zero", async () => {
  const targetFixture = fixture({ id: 202 });
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures: [targetFixture],
    metrics: new Map([[202, null]]),
  });
  const repository = new MemorySportsCacheRepository();

  const first = await loadSample(provider, repository, 1);
  const second = await loadSample(provider, repository, 1);
  const cachedMetric = await repository.getMetric("BSD", 202, TEAM_BSD.id, "corners");

  assert.equal(first[0], null);
  assert.equal(second[0], null);
  assert.equal(cachedMetric.value, null);
  assert.equal(provider.calls.metrics, 1);
});

test("F. cache stale consulta provider e atualiza a métrica", async () => {
  const targetFixture = fixture({ id: 203, date: "2026-06-01T18:00:00.000Z" });
  const metrics = new Map([[203, 4]]);
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures: [targetFixture],
    metrics,
  });
  const repository = new MemorySportsCacheRepository();

  await loadSample(provider, repository, 1);
  repository.setMetricFetchedAt(
    "BSD",
    203,
    TEAM_BSD.id,
    "corners",
    new Date(NOW - 31 * 24 * 60 * 60 * 1000).toISOString(),
  );
  metrics.set(203, 9);

  const refreshed = await loadSample(provider, repository, 1);
  assert.equal(refreshed[0].value, 9);
  assert.equal(provider.calls.metrics, 2);
});

test("G. falha ao escrever cache não derruba um resultado válido do provider", async () => {
  const targetFixture = fixture({ id: 204 });
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures: [targetFixture],
    metrics: new Map([[204, 7]]),
  });
  const repository = new MetricWriteFailingRepository();
  const cached = new CachedSportsDataProvider(provider, repository, () => NOW);

  const result = await cached.getFixtureMetric(targetFixture, TEAM_BSD.id, "corners");
  assert.equal(result.value, 7);
  assert.equal(result.source, "BSD");
});

test("H. resultado híbrido BSD + API-Football preserva proveniência e cache por provider", async () => {
  const bsdFixture = fixture({ id: 301, date: "2026-08-10T18:00:00.000Z" });
  const apiFixture = fixture({
    id: 901,
    date: "2026-08-10T18:30:00.000Z",
    home: { id: TEAM_API.id, name: TEAM_API.name },
    away: { id: 777, name: "Palmeiras" },
  });
  const bsd = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures: [bsdFixture],
    metrics: new Map([[301, null]]),
  });
  const api = new FakeProvider({
    name: "API-FOOTBALL",
    team: TEAM_API,
    fixtures: [apiFixture],
    metrics: new Map([[901, 8]]),
  });
  const repository = new MemorySportsCacheRepository();

  const run = async () => {
    const orchestrator = new FootballProviderOrchestrator(
      new CachedSportsDataProvider(bsd, repository, () => NOW),
      new CachedSportsDataProvider(api, repository, () => NOW),
    );
    const selection = await orchestrator.selectTeamFixtures("Corinthians", 1);
    return orchestrator.getSelectedFixtureMetrics(selection, "corners");
  };

  const first = await run();
  const callsAfterFirst = { bsd: structuredClone(bsd.calls), api: structuredClone(api.calls) };
  const second = await run();

  assert.equal(first[0].source, "API-FOOTBALL");
  assert.equal(second[0].source, "API-FOOTBALL");
  assert.deepEqual(bsd.calls, callsAfterFirst.bsd);
  assert.deepEqual(api.calls, callsAfterFirst.api);
});

test("I. filtros home/away/competição continuam sendo aplicados sobre fixtures cacheadas", async () => {
  const fixtures = [
    fixture({ id: 401, competition: "Brasileirão Série A" }),
    fixture({
      id: 402,
      date: "2026-08-05T18:00:00.000Z",
      competition: "Brasileirão Série A",
      home: { id: 888, name: "Santos" },
      away: { id: TEAM_BSD.id, name: TEAM_BSD.name },
    }),
    fixture({ id: 403, date: "2026-08-09T18:00:00.000Z", competition: "Copa do Brasil" }),
  ];
  const provider = new FakeProvider({ name: "BSD", team: TEAM_BSD, fixtures, metrics: new Map() });
  const repository = new MemorySportsCacheRepository();

  const first = new FilteredSportsDataProvider(
    new CachedSportsDataProvider(provider, repository, () => NOW),
  );
  const team = await first.resolveTeam("Corinthians");
  const home = await first.getRecentTeamFixtures(team.id, 5, {
    venue: "home",
    competitionNames: ["Brasileirão Série A"],
  });

  const second = new FilteredSportsDataProvider(
    new CachedSportsDataProvider(provider, repository, () => NOW),
  );
  const cachedTeam = await second.resolveTeam("Corinthians");
  const away = await second.getRecentTeamFixtures(cachedTeam.id, 5, {
    venue: "away",
    competitionNames: ["Brasileirão Série A"],
  });

  assert.deepEqual(
    home.map((item) => item.id),
    [401],
  );
  assert.deepEqual(
    away.map((item) => item.id),
    [402],
  );
  assert.equal(provider.calls.fixtures, 1);
});

test("J. cache nunca inventa estatística para completar a amostra", async () => {
  const targetFixture = fixture({ id: 501 });
  const provider = new FakeProvider({
    name: "BSD",
    team: TEAM_BSD,
    fixtures: [targetFixture],
    metrics: new Map([[501, null]]),
  });
  const repository = new MemorySportsCacheRepository();
  const orchestrator = new FootballProviderOrchestrator(
    new CachedSportsDataProvider(provider, repository, () => NOW),
  );
  const selection = await orchestrator.selectTeamFixtures("Corinthians", 1);

  await assert.rejects(
    () => orchestrator.getSelectedFixtureMetrics(selection, "corners"),
    (error) => error?.code === "DATA_INSUFFICIENT",
  );
  const cachedMetric = await repository.getMetric("BSD", 501, TEAM_BSD.id, "corners");
  assert.equal(cachedMetric.value, null);
});

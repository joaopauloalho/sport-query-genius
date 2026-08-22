import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeFootballEntityName,
  resolveFootballEntityCandidates,
} from "../../src/server/sports/entity-resolver.ts";
import { PlayerDataService } from "../../src/server/sports/player-data-service.server.ts";
import {
  playerMetricValue,
  playerParticipated,
} from "../../src/server/sports/player-provider.ts";
import { getVerifiedEntityAlias } from "../../src/server/sports/verified-aliases.ts";

const clone = (value) => structuredClone(value);

const PLAYER = {
  id: 1146,
  name: "Yuri Alberto",
  teamId: 131,
  teamName: "Corinthians",
  position: "FWD",
  country: "Brazil",
};

function stat({
  fixtureId,
  timestamp,
  minutes = 90,
  goals = 0,
  assists = 0,
  shots = null,
  shotsOnTarget = null,
  cards = 0,
}) {
  return {
    fixtureId,
    date: new Date(timestamp * 1000).toISOString(),
    timestamp,
    competition: "Brasileirão Serie A",
    teamId: 131,
    teamName: "Corinthians",
    opponentId: 9000 + fixtureId,
    opponentName: `Adversário ${fixtureId}`,
    venue: fixtureId % 2 ? "home" : "away",
    result: "1-0",
    minutes,
    goals,
    assists,
    shots,
    shotsOnTarget,
    cards,
    shotmapCovered: false,
    source: "BSD",
  };
}

function goalEvent(fixture, minute, suffix) {
  return {
    eventKey: `${fixture.fixtureId}:goal:${minute}:${suffix}`,
    fixtureId: fixture.fixtureId,
    date: fixture.date,
    timestamp: fixture.timestamp,
    competition: fixture.competition,
    teamId: fixture.teamId,
    teamName: fixture.teamName,
    opponentId: fixture.opponentId,
    opponentName: fixture.opponentName,
    venue: fixture.venue,
    result: fixture.result,
    minute,
    extraTime: null,
    situation: "Regular",
    bodyPart: "Right foot",
    xg: 0.2,
    xgEstimated: false,
    source: "BSD",
  };
}

class MemoryRepository {
  constructor() {
    this.aliases = new Map();
    this.players = new Map();
    this.stats = new Map();
    this.events = new Map();
  }

  aliasKey(provider, entityType, alias) {
    return `${provider}:${entityType}:${normalizeFootballEntityName(alias)}`;
  }

  playerKey(provider, playerId) {
    return `${provider}:${playerId}`;
  }

  async getAlias(provider, entityType, alias) {
    return this.aliases.get(this.aliasKey(provider, entityType, alias)) ?? null;
  }

  async upsertAlias(alias) {
    this.aliases.set(this.aliasKey(alias.provider, alias.entityType, alias.alias), clone(alias));
  }

  async getPlayerById(provider, playerId) {
    return clone(this.players.get(this.playerKey(provider, playerId)) ?? null);
  }

  async getPlayerByNormalizedName(provider, normalizedName) {
    return (
      [...this.players.values()].find(
        (player) =>
          player.provider === provider &&
          normalizeFootballEntityName(player.name) === normalizedName,
      ) ?? null
    );
  }

  async upsertPlayer(provider, player) {
    const key = this.playerKey(provider, player.id);
    const existing = this.players.get(key);
    this.players.set(key, {
      ...clone(player),
      provider,
      fetchedAt: new Date().toISOString(),
      statsFetchedAt: existing?.statsFetchedAt ?? null,
      statsRequestedCount: existing?.statsRequestedCount ?? 0,
      statsReturnedCount: existing?.statsReturnedCount ?? 0,
      eventsFetchedAt: existing?.eventsFetchedAt ?? null,
    });
  }

  async listRecentPlayerStats(provider, playerId, limit) {
    return (this.stats.get(this.playerKey(provider, playerId)) ?? [])
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit)
      .map(clone);
  }

  async upsertPlayerStats(provider, playerId, rows) {
    const key = this.playerKey(provider, playerId);
    const byFixture = new Map(
      (this.stats.get(key) ?? []).map((row) => [row.fixtureId, clone(row)]),
    );
    for (const row of rows) byFixture.set(row.fixtureId, clone(row));
    this.stats.set(key, [...byFixture.values()]);
  }

  async markPlayerStatsFetched(provider, playerId, requestedCount, returnedCount) {
    const key = this.playerKey(provider, playerId);
    const player = this.players.get(key);
    this.players.set(key, {
      ...player,
      statsFetchedAt: new Date().toISOString(),
      statsRequestedCount: requestedCount,
      statsReturnedCount: returnedCount,
    });
  }

  async listPlayerGoalEvents(provider, playerId, limit) {
    return (this.events.get(this.playerKey(provider, playerId)) ?? [])
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp || (b.minute ?? -1) - (a.minute ?? -1))
      .slice(0, limit)
      .map(clone);
  }

  async upsertPlayerEvents(provider, playerId, rows) {
    const key = this.playerKey(provider, playerId);
    const byKey = new Map(
      (this.events.get(key) ?? []).map((row) => [row.eventKey, clone(row)]),
    );
    for (const row of rows) byKey.set(row.eventKey, clone(row));
    this.events.set(key, [...byKey.values()]);
  }

  async markPlayerEventsFetched(provider, playerId) {
    const key = this.playerKey(provider, playerId);
    const player = this.players.get(key);
    this.players.set(key, { ...player, eventsFetchedAt: new Date().toISOString() });
  }
}

class FakePlayerProvider {
  constructor(stats) {
    this.name = "BSD";
    this.stats = stats;
    this.shots = new Map();
    this.goalEvents = new Map();
    this.calls = { resolve: 0, getById: 0, stats: 0, shots: 0, events: 0 };
  }

  async resolvePlayer() {
    this.calls.resolve += 1;
    return clone(PLAYER);
  }

  async getPlayerById() {
    this.calls.getById += 1;
    return clone(PLAYER);
  }

  async getRecentPlayerStats() {
    this.calls.stats += 1;
    return this.stats.map(clone);
  }

  async getFixtureShotStats(fixtureId) {
    this.calls.shots += 1;
    return this.shots.get(fixtureId) ?? { coverage: false, shots: null, shotsOnTarget: null };
  }

  async getGoalEventsForFixture(fixture) {
    this.calls.events += 1;
    return {
      coverage: true,
      events: (this.goalEvents.get(fixture.fixtureId) ?? []).map(clone),
    };
  }
}

test("A. normalização preserva identidade útil e remove ruído superficial", () => {
  assert.equal(normalizeFootballEntityName("  FC Bayern München!! "), "fc bayern munchen");
  assert.equal(normalizeFootballEntityName("Atlético de Madrid"), "atletico de madrid");
});

test("B. aliases verificados do Bayern apontam para 79 e nunca para FC Bayern Alzenau 8160", () => {
  for (const alias of ["Bayern de Munique", "Bayern Munich", "Bayern München"]) {
    const resolved = getVerifiedEntityAlias("BSD", "team", alias);
    assert.ok(resolved);
    assert.equal(resolved.providerEntityId, 79);
    assert.equal(resolved.canonicalName, "FC Bayern München");
    assert.notEqual(resolved.providerEntityId, 8160);
  }
});

test("C. busca genérica Bayern não escolhe silenciosamente entre München e Alzenau", () => {
  const resolution = resolveFootballEntityCandidates("Bayern", [
    { id: 79, name: "FC Bayern München", country: "Germany" },
    { id: 8160, name: "FC Bayern Alzenau", country: "Germany" },
  ]);
  assert.equal(resolution.status, "ambiguous");
});

test("D. nomes exatos conhecidos continuam resolvendo deterministicamente", () => {
  for (const name of ["Corinthians", "Manchester United", "Arsenal"]) {
    const resolution = resolveFootballEntityCandidates(name, [
      { id: 1, name },
      { id: 2, name: `${name} Academy` },
    ]);
    assert.equal(resolution.status, "resolved");
    assert.equal(resolution.candidate.name, name);
  }
});

test("E. Inter curto é ambíguo quando múltiplos candidatos plausíveis existem", () => {
  const resolution = resolveFootballEntityCandidates("Inter", [
    { id: 77, name: "Inter", country: "Italy" },
    { id: 293, name: "Inter Miami", country: "USA" },
    { id: 1000, name: "Inter Turku", country: "Finland" },
  ]);
  assert.equal(resolution.status, "ambiguous");
  assert.ok(resolution.candidates.length >= 2);
});

test("F. jogo com 0 minutos não vira participação; zero real continua zero e null continua ausente", () => {
  const bench = stat({ fixtureId: 1, timestamp: 100, minutes: 0, goals: 0, shots: null });
  const played = stat({ fixtureId: 2, timestamp: 200, minutes: 90, goals: 0, shots: 0 });
  assert.equal(playerParticipated(bench), false);
  assert.equal(playerParticipated(played), true);
  assert.equal(playerMetricValue(played, "shots"), 0);
  assert.equal(playerMetricValue(bench, "shots"), null);
});

test("G. Yuri Alberto usa alias + identidade cacheada sem repetir lookup do provider", async () => {
  const provider = new FakePlayerProvider([]);
  const repository = new MemoryRepository();
  const service = new PlayerDataService(provider, repository);

  const first = await service.resolvePlayer("Yuri Alberto");
  const second = await service.resolvePlayer("Yuri Alberto");

  assert.equal(first.id, 1146);
  assert.equal(second.id, 1146);
  assert.equal(first.teamName, "Corinthians");
  assert.deepEqual(provider.calls, { resolve: 0, getById: 1, stats: 0, shots: 0, events: 0 });
});

test("H. últimos jogos do jogador usam participação real e a segunda leitura reutiliza o cache", async () => {
  const rows = [
    stat({ fixtureId: 1, timestamp: 100, minutes: 0 }),
    stat({ fixtureId: 2, timestamp: 200, shots: 1 }),
    stat({ fixtureId: 3, timestamp: 300, shots: 2 }),
    stat({ fixtureId: 4, timestamp: 400, shots: 3 }),
    stat({ fixtureId: 5, timestamp: 500, shots: 4 }),
    stat({ fixtureId: 6, timestamp: 600, shots: 5 }),
  ];
  const provider = new FakePlayerProvider(rows);
  const repository = new MemoryRepository();
  const service = new PlayerDataService(provider, repository);
  const player = await service.resolvePlayer("Yuri Alberto");

  const first = await service.getRecentParticipatedStats(player, 5);
  const second = await service.getRecentParticipatedStats(player, 5);

  assert.deepEqual(first.map((row) => row.fixtureId), [2, 3, 4, 5, 6]);
  assert.deepEqual(second.map((row) => row.fixtureId), [2, 3, 4, 5, 6]);
  assert.equal(provider.calls.stats, 1);
});

test("I. shotmap com cobertura pode provar zero; sem cobertura mantém null", async () => {
  const provider = new FakePlayerProvider([]);
  provider.shots.set(10, { coverage: true, shots: 0, shotsOnTarget: 0 });
  provider.shots.set(11, { coverage: false, shots: null, shotsOnTarget: null });
  const service = new PlayerDataService(provider, null);

  const zero = await service.ensureMetric(
    PLAYER,
    [stat({ fixtureId: 10, timestamp: 1000, shots: null, shotsOnTarget: null })],
    "shots",
  );
  const missing = await service.ensureMetric(
    PLAYER,
    [stat({ fixtureId: 11, timestamp: 1100, shots: null, shotsOnTarget: null })],
    "shots",
  );

  assert.equal(zero[0].shots, 0);
  assert.equal(zero[0].shotsOnTarget, 0);
  assert.equal(missing[0].shots, null);
});

test("J. últimos 5 gols contam eventos individuais, inclusive dois na mesma partida, e cacheiam", async () => {
  const rows = [
    stat({ fixtureId: 21, timestamp: 2100, goals: 2 }),
    stat({ fixtureId: 22, timestamp: 2200, goals: 1 }),
    stat({ fixtureId: 23, timestamp: 2300, goals: 2 }),
  ];
  const provider = new FakePlayerProvider(rows);
  provider.goalEvents.set(21, [goalEvent(rows[0], 20, "a"), goalEvent(rows[0], 70, "b")]);
  provider.goalEvents.set(22, [goalEvent(rows[1], 40, "a")]);
  provider.goalEvents.set(23, [goalEvent(rows[2], 15, "a"), goalEvent(rows[2], 80, "b")]);
  const repository = new MemoryRepository();
  const service = new PlayerDataService(provider, repository);
  const player = await service.resolvePlayer("Yuri Alberto");

  const first = await service.getRecentGoalEvents(player, 5);
  const callsAfterFirst = provider.calls.events;
  const second = await service.getRecentGoalEvents(player, 5);

  assert.equal(first.length, 5);
  assert.equal(first.filter((event) => event.fixtureId === 23).length, 2);
  assert.deepEqual(
    first.map((event) => [event.fixtureId, event.minute]),
    [
      [23, 80],
      [23, 15],
      [22, 40],
      [21, 70],
      [21, 20],
    ],
  );
  assert.deepEqual(second.map((event) => event.eventKey), first.map((event) => event.eventKey));
  assert.equal(provider.calls.events, callsAfterFirst);
});

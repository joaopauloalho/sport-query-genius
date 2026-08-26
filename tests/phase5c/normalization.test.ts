import { describe, expect, test } from "bun:test";

import {
  normalizeApiFootballFixturePlayers,
  normalizeBsdPlayerMatchRows,
  playerMatchStatValue,
} from "../../src/server/sports/player-match-stats";
import type { ProviderFixture } from "../../src/server/sports/provider";

const fixture: ProviderFixture = {
  id: 9001,
  date: "2026-08-20T20:00:00.000Z",
  timestamp: Math.floor(Date.parse("2026-08-20T20:00:00.000Z") / 1000),
  status: "finished",
  competition: "Brasileirão Série A",
  competitionId: "71",
  seasonId: "2026",
  country: "Brazil",
  home: { id: 167, name: "Corinthians" },
  away: { id: 176, name: "Palmeiras" },
  goals: { home: 2, away: 1 },
};

describe("Phase 5C BSD player contract normalization", () => {
  test("integer, rating, percentage string and explicit zero stay observed", () => {
    const [snapshot] = normalizeBsdPlayerMatchRows({
      playerId: 1001,
      fixtures: [fixture],
      rows: [
        {
          event_id: 9001,
          team_id: 167,
          stats: {
            minutes: 90,
            goals: 0,
            assists: 1,
            passes: 43,
            pass_accuracy: "85%",
            rating: "7.4",
            shots: 0,
          },
        },
      ],
    });
    expect(playerMatchStatValue(snapshot, "goals")).toMatchObject({ value: 0, observed: true });
    expect(playerMatchStatValue(snapshot, "passes")).toMatchObject({ value: 43, observed: true });
    expect(playerMatchStatValue(snapshot, "pass_accuracy")).toMatchObject({
      value: 85,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "rating")).toMatchObject({ value: 7.4, observed: true });
    expect(playerMatchStatValue(snapshot, "goal_contributions")).toMatchObject({
      value: 1,
      observed: true,
    });
  });

  test("null, absent, empty and malformed fields remain UNKNOWN", () => {
    const [snapshot] = normalizeBsdPlayerMatchRows({
      playerId: 1001,
      fixtures: [fixture],
      rows: [
        {
          event_id: 9001,
          team_id: 167,
          stats: {
            minutes: 90,
            goals: null,
            assists: "",
            passes: "not-a-number",
          },
        },
      ],
    });
    expect(playerMatchStatValue(snapshot, "goals").observed).toBe(false);
    expect(playerMatchStatValue(snapshot, "assists").observed).toBe(false);
    expect(playerMatchStatValue(snapshot, "passes").observed).toBe(false);
    expect(playerMatchStatValue(snapshot, "rating").observed).toBe(false);
    expect(playerMatchStatValue(snapshot, "goal_contributions").observed).toBe(false);
  });

  test("cards do not treat a missing component as zero", () => {
    const [snapshot] = normalizeBsdPlayerMatchRows({
      playerId: 1001,
      fixtures: [fixture],
      rows: [
        {
          event_id: 9001,
          team_id: 167,
          stats: { minutes: 90, yellow_cards: 1, red_cards: null },
        },
      ],
    });
    expect(playerMatchStatValue(snapshot, "yellow_cards")).toMatchObject({
      value: 1,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "red_cards").observed).toBe(false);
    expect(playerMatchStatValue(snapshot, "cards").observed).toBe(false);
  });

  test("zero minutes with real contribution still proves participation", () => {
    const [snapshot] = normalizeBsdPlayerMatchRows({
      playerId: 1001,
      fixtures: [fixture],
      rows: [{ event_id: 9001, team_id: 167, stats: { minutes: 0, goals: 1, assists: 0 } }],
    });
    expect(snapshot.participated).toBe(true);
  });

  test("unused substitute with zero minutes and no positive evidence is not an appearance", () => {
    const [snapshot] = normalizeBsdPlayerMatchRows({
      playerId: 1001,
      fixtures: [fixture],
      rows: [
        {
          event_id: 9001,
          team_id: 167,
          stats: { minutes: 0, goals: 0, assists: 0, shots: 0, passes: 0 },
        },
      ],
    });
    expect(snapshot.participated).toBe(false);
  });

  test("real BSD v2 top-level player field names remain observed", () => {
    const [snapshot] = normalizeBsdPlayerMatchRows({
      playerId: 1146,
      fixtures: [fixture],
      rows: [
        {
          event_id: 9001,
          team_id: 167,
          minutes_played: 88,
          goals: 0,
          goal_assist: 0,
          total_shots: 5,
          shots_on_target: 2,
          blocked_scoring_attempt: 1,
          rating: 6.3,
          total_pass: 27,
          accurate_pass: 20,
          key_pass: 2,
          total_cross: 3,
          accurate_cross: 1,
          total_long_balls: 4,
          accurate_long_balls: 2,
          duel_won: 5,
          aerial_won: 2,
          total_contest: 3,
          won_contest: 1,
          total_tackle: 1,
          won_tackle: 1,
          interception: 0,
          total_clearance: 2,
          ball_recovery: 4,
          big_chance_missed: 0,
        },
      ],
    });

    expect(playerMatchStatValue(snapshot, "passes")).toMatchObject({ value: 27, observed: true });
    expect(playerMatchStatValue(snapshot, "accurate_passes")).toMatchObject({
      value: 20,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "key_passes")).toMatchObject({
      value: 2,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "blocked_shots")).toMatchObject({
      value: 1,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "crosses")).toMatchObject({ value: 3, observed: true });
    expect(playerMatchStatValue(snapshot, "accurate_crosses")).toMatchObject({
      value: 1,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "long_balls")).toMatchObject({
      value: 4,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "duels_won")).toMatchObject({ value: 5, observed: true });
    expect(playerMatchStatValue(snapshot, "aerial_duels_won")).toMatchObject({
      value: 2,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "dribbles")).toMatchObject({ value: 3, observed: true });
    expect(playerMatchStatValue(snapshot, "successful_dribbles")).toMatchObject({
      value: 1,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "tackles")).toMatchObject({ value: 1, observed: true });
    expect(playerMatchStatValue(snapshot, "tackles_won")).toMatchObject({
      value: 1,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "interceptions")).toMatchObject({
      value: 0,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "clearances")).toMatchObject({
      value: 2,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "recoveries")).toMatchObject({
      value: 4,
      observed: true,
    });
    expect(playerMatchStatValue(snapshot, "big_chances_missed")).toMatchObject({
      value: 0,
      observed: true,
    });
  });
});

describe("Phase 5C API-Football /fixtures/players contract normalization", () => {
  test("one fixture payload normalizes multiple players without deriving accurate passes", () => {
    const snapshots = normalizeApiFootballFixturePlayers({
      fixture,
      payload: {
        response: [
          {
            team: { id: 167, name: "Corinthians" },
            players: [
              {
                player: { id: 1001, name: "Player One" },
                statistics: [
                  {
                    games: { minutes: 90, rating: "7.1", substitute: false },
                    shots: { total: 3, on: 1 },
                    goals: { total: 1, assists: 0, saves: null },
                    passes: { total: 43, key: 2, accuracy: "86%" },
                    tackles: { total: 2, interceptions: 1 },
                    duels: { total: 8, won: 5 },
                    dribbles: { attempts: 4, success: 2 },
                    fouls: { drawn: 1, committed: 2 },
                    cards: { yellow: 0, red: 0 },
                  },
                ],
              },
              {
                player: { id: 1002, name: "Player Two" },
                statistics: [
                  {
                    games: { minutes: 30, rating: "6.8", substitute: true },
                    shots: { total: 0, on: 0 },
                    goals: { total: 0, assists: 1 },
                    passes: { total: 12, key: 1, accuracy: "75%" },
                    tackles: { total: 0, interceptions: 0 },
                    duels: { total: 2, won: 1 },
                    dribbles: { attempts: 0, success: 0 },
                    fouls: { drawn: 0, committed: 0 },
                    cards: { yellow: 0, red: 0 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(snapshots).toHaveLength(2);
    expect(playerMatchStatValue(snapshots[0], "passes").value).toBe(43);
    expect(playerMatchStatValue(snapshots[0], "pass_accuracy").value).toBe(86);
    expect(playerMatchStatValue(snapshots[0], "accurate_passes").observed).toBe(false);
    expect(playerMatchStatValue(snapshots[1], "assists").value).toBe(1);
    expect(snapshots[1].substitute).toBe(true);
  });

  test("duplicate player rows remain fixture-scoped snapshots and malformed numbers stay UNKNOWN", () => {
    const snapshots = normalizeApiFootballFixturePlayers({
      fixture,
      payload: {
        response: [
          {
            team: { id: 167 },
            players: [
              {
                player: { id: 1001 },
                statistics: [
                  {
                    games: { minutes: 90, rating: "bad", substitute: false },
                    goals: { total: 0, assists: 0 },
                  },
                ],
              },
              {
                player: { id: 1001 },
                statistics: [
                  {
                    games: { minutes: 1, rating: "7", substitute: true },
                    goals: { total: 0, assists: 0 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(snapshots).toHaveLength(2);
    expect(playerMatchStatValue(snapshots[0], "rating").observed).toBe(false);
    expect(playerMatchStatValue(snapshots[1], "rating").value).toBe(7);
  });
});

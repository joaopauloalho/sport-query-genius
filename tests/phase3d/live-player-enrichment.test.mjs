import assert from "node:assert/strict";
import test from "node:test";

import { hydrateBsdPlayerStatRows } from "../../src/server/sports/providers/bsd-player-enrichment.ts";
import { playerParticipated } from "../../src/server/sports/player-provider.ts";

const player = {
  id: 1146,
  name: "Yuri Alberto",
  teamId: 167,
  teamName: "Corinthians",
  position: "F",
  country: "Brazil",
};

const fixtures = [
  {
    id: 7001,
    date: "2026-08-10T20:00:00Z",
    timestamp: 1786392000,
    status: "finished",
    competition: "Brasileirão Série A",
    home: { id: 167, name: "Corinthians" },
    away: { id: 900, name: "Remo" },
    goals: { home: 2, away: 0 },
  },
  {
    id: 7002,
    date: "2026-08-14T20:00:00Z",
    timestamp: 1786737600,
    status: "finished",
    competition: "Club Friendlies",
    home: { id: 901, name: "Cascavel" },
    away: { id: 167, name: "Corinthians" },
    goals: { home: 0, away: 0 },
  },
];

test("live BSD stat rows are joined to fixture metadata by event_id", () => {
  const rows = hydrateBsdPlayerStatRows({
    player,
    fixtures,
    rows: [
      {
        player_id: 1146,
        event_id: 7001,
        team_id: 167,
        minutes_played: 90,
        goals: 2,
        goal_assist: 1,
        total_shots: 6,
        shots_on_target: 4,
        yellow_card: 1,
        red_card: 0,
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fixtureId, 7001);
  assert.equal(rows[0].opponentName, "Remo");
  assert.equal(rows[0].venue, "home");
  assert.equal(rows[0].result, "2-0");
  assert.equal(rows[0].minutes, 90);
  assert.equal(rows[0].goals, 2);
  assert.equal(rows[0].assists, 1);
  assert.equal(rows[0].shots, 6);
  assert.equal(rows[0].shotsOnTarget, 4);
  assert.equal(rows[0].cards, 1);
});

test("zero-minute rows remain zero and are excluded by participation logic", () => {
  const rows = hydrateBsdPlayerStatRows({
    player,
    fixtures,
    rows: [
      {
        player_id: 1146,
        event_id: 7002,
        team_id: 167,
        minutes_played: 0,
        goals: 0,
        goal_assist: 0,
        total_shots: 0,
        shots_on_target: 0,
        yellow_card: 0,
        red_card: 0,
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].minutes, 0);
  assert.equal(rows[0].goals, 0);
  assert.equal(rows[0].shots, 0);
  assert.equal(playerParticipated(rows[0]), false);
});

test("competition filtering is applied after fixture enrichment", () => {
  const rows = hydrateBsdPlayerStatRows({
    player,
    fixtures,
    competitionNames: ["Brasileirão Série A"],
    rows: [
      { event_id: 7001, team_id: 167, minutes_played: 90, goals: 2 },
      { event_id: 7002, team_id: 167, minutes_played: 0, goals: 0 },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.fixtureId),
    [7001],
  );
});

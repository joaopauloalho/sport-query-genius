import { describe, expect, test } from "bun:test";

import type { ProviderFixture, ResolvedTeam } from "../../src/server/sports/provider";
import {
  enrichBsdGoalsWithShotmap,
  fixtureMatchesScope,
  incidentToTeamEvent,
  parseApiFootballIncidents,
  parseBsdIncidents,
} from "../../src/server/sports/universal-football";

const fixture: ProviderFixture = {
  id: 9001,
  date: "2026-08-20T23:30:00.000Z",
  timestamp: 1787278200,
  status: "finished",
  competition: "Brasileirão Série A",
  home: { id: 1, name: "Corinthians" },
  away: { id: 2, name: "Palmeiras" },
  goals: { home: 2, away: 1 },
};
const corinthians: ResolvedTeam = { id: 1, name: "Corinthians", country: "Brazil" };

describe("Phase 4B provider incident contracts", () => {
  test("BSD preserves two goals by the same player as two distinct events", () => {
    const events = parseBsdIncidents(
      {
        results: [
          {
            incident_type: "goal",
            team_id: 1,
            player: { id: 10, name: "Yuri Alberto" },
            assist: { id: 8, name: "Rodrigo Garro" },
            minute: 15,
          },
          {
            incident_type: "goal",
            team_id: 1,
            player: { id: 10, name: "Yuri Alberto" },
            assist: { id: 8, name: "Rodrigo Garro" },
            minute: 64,
          },
        ],
      },
      fixture,
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.actor?.name).toBe("Yuri Alberto");
    expect(events[1]?.actor?.name).toBe("Yuri Alberto");
    expect(events[0]?.eventKey).not.toBe(events[1]?.eventKey);
    expect(events.map((event) => event.minute)).toEqual([15, 64]);
  });

  test("assist query is derived from the proven goal incident and keeps scorer as secondary actor", () => {
    const [goal] = parseBsdIncidents(
      {
        results: [
          {
            incident_type: "goal",
            team_id: 1,
            player: { id: 10, name: "Yuri Alberto" },
            assist: { id: 8, name: "Rodrigo Garro" },
            minute: 42,
          },
        ],
      },
      fixture,
    );
    const assist = incidentToTeamEvent(goal!, fixture, corinthians, "assist");

    expect(assist?.actor?.name).toBe("Rodrigo Garro");
    expect(assist?.secondaryActor?.name).toBe("Yuri Alberto");
    expect(assist?.minute).toBe(42);
  });

  test("rescinded BSD yellow card never becomes a valid team yellow-card event", () => {
    const [card] = parseBsdIncidents(
      {
        results: [
          {
            incident_type: "card",
            detail: "Yellow Card",
            team_id: 1,
            player: { id: 20, name: "Jogador Teste" },
            minute: 33,
            rescinded: true,
          },
        ],
      },
      fixture,
    );

    expect(card?.eventType).toBe("yellow_card");
    expect(card?.rescinded).toBe(true);
    expect(incidentToTeamEvent(card!, fixture, corinthians, "yellow_card")).toBeNull();
  });

  test("BSD substitution preserves incoming and outgoing players", () => {
    const [substitution] = parseBsdIncidents(
      {
        results: [
          {
            incident_type: "substitution",
            team_id: 1,
            player_in: { id: 30, name: "Entrou" },
            player_out: { id: 31, name: "Saiu" },
            minute: 71,
          },
        ],
      },
      fixture,
    );

    expect(substitution?.eventType).toBe("substitution");
    expect(substitution?.actor?.name).toBe("Entrou");
    expect(substitution?.secondaryActor?.name).toBe("Saiu");
  });

  test("API-Football goal/card/substitution contract maps to the same canonical event vocabulary", () => {
    const events = parseApiFootballIncidents(
      {
        response: [
          {
            time: { elapsed: 12, extra: null },
            team: { id: 1, name: "Corinthians" },
            player: { id: 10, name: "Yuri Alberto" },
            assist: { id: 8, name: "Rodrigo Garro" },
            type: "Goal",
            detail: "Normal Goal",
          },
          {
            time: { elapsed: 55 },
            team: { id: 1, name: "Corinthians" },
            player: { id: 22, name: "Amarelado" },
            type: "Card",
            detail: "Yellow Card",
          },
          {
            time: { elapsed: 70 },
            team: { id: 1, name: "Corinthians" },
            player: { id: 31, name: "Saiu" },
            assist: { id: 30, name: "Entrou" },
            type: "subst",
            detail: "Substitution 1",
          },
        ],
      },
      fixture,
    );

    expect(events.map((event) => event.eventType)).toEqual([
      "goal",
      "yellow_card",
      "substitution",
    ]);
    expect(events[0]?.secondaryActor?.name).toBe("Rodrigo Garro");
    expect(events[2]?.actor?.name).toBe("Entrou");
    expect(events[2]?.secondaryActor?.name).toBe("Saiu");
  });

  test("penalty shootout records are ignored instead of being mixed with match goals", () => {
    const events = parseBsdIncidents(
      {
        results: [
          {
            incident_type: "goal",
            detail: "Penalty shootout",
            team_id: 1,
            player: { id: 10, name: "Yuri Alberto" },
            minute: 120,
          },
        ],
      },
      fixture,
    );
    expect(events).toHaveLength(0);
  });

  test("BSD shotmap enriches a goal only when exactly one conservative candidate matches", () => {
    const incidents = parseBsdIncidents(
      {
        results: [
          {
            incident_type: "goal",
            team_id: 1,
            player: { id: 10, name: "Yuri Alberto" },
            minute: 15,
          },
        ],
      },
      fixture,
    );
    const enriched = enrichBsdGoalsWithShotmap(
      incidents,
      {
        shotmap: [
          {
            player_id: 10,
            home: true,
            min: 15,
            type: "goal",
            sit: "open_play",
            body: "right_foot",
            xg: 0.42,
            xg_estimated: false,
          },
        ],
      },
      fixture,
    );
    expect(enriched[0]?.xg).toBe(0.42);
    expect(enriched[0]?.bodyPart).toBe("right_foot");
    expect(enriched[0]?.situation).toBe("open_play");

    const ambiguous = enrichBsdGoalsWithShotmap(
      incidents,
      {
        shotmap: [
          { player_id: 10, home: true, min: 15, type: "goal", xg: 0.4 },
          { player_id: 10, home: true, min: 15, type: "goal", xg: 0.5 },
        ],
      },
      fixture,
    );
    expect(ambiguous[0]?.xg).toBeNull();
  });

  test("scope filters never use a different opponent or venue to complete a sample", () => {
    expect(
      fixtureMatchesScope(fixture, corinthians, {
        venue: "home",
        half: "full",
        status: "finished",
        opponent: "Palmeiras",
      }),
    ).toBe(true);
    expect(
      fixtureMatchesScope(fixture, corinthians, {
        venue: "away",
        half: "full",
        status: "finished",
      }),
    ).toBe(false);
    expect(
      fixtureMatchesScope(fixture, corinthians, {
        venue: "home",
        half: "full",
        status: "finished",
        opponent: "Flamengo",
      }),
    ).toBe(false);
  });
});

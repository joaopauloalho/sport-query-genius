import { z } from "zod";

import type { MatchRecord } from "@/data/sports";
import { AnalysisPipelineError } from "@/server/analysis/errors";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "../provider";

const BSD_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TIMEOUT_MS = 15_000;

const paginatedSchema = z
  .object({
    results: z.array(z.record(z.unknown())),
  })
  .passthrough();

const statsSchema = z
  .object({
    stats: z.object({
      home: z.record(z.unknown()),
      away: z.record(z.unknown()),
    }),
    shotmap: z.array(z.record(z.unknown())).optional().default([]),
  })
  .passthrough();

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace("%", "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readTeam(record: Record<string, unknown>, key: "home_team" | "away_team" | "home" | "away") {
  const team = asRecord(record[key]);
  if (!team) return null;

  const id = readNumber(team, ["id", "team_id"]);
  const name = readString(team, ["name", "team_name", "short_name"]);
  if (id === null || !name) return null;
  return { id, name };
}

function readCompetition(record: Record<string, unknown>): string {
  const league = asRecord(record.league) ?? asRecord(record.competition);
  return (
    (league && readString(league, ["name", "league_name", "competition_name"])) ??
    readString(record, ["league_name", "competition_name", "competition"]) ??
    "Competição"
  );
}

function readScore(record: Record<string, unknown>, side: "home" | "away"): number | null {
  const direct = readNumber(record, [
    `${side}_score`,
    `${side}_goals`,
    `score_${side}`,
  ]);
  if (direct !== null) return direct;

  const score = asRecord(record.score) ?? asRecord(record.scores);
  if (!score) return null;
  return readNumber(score, [side, `${side}_score`, `${side}_goals`, `full_time_${side}`]);
}

function readFixture(raw: Record<string, unknown>): ProviderFixture | null {
  const id = readNumber(raw, ["id", "event_id"]);
  const date = readString(raw, [
    "event_date",
    "start_time",
    "kickoff_at",
    "kickoff",
    "start_at",
    "date",
  ]);
  const home = readTeam(raw, "home_team") ?? readTeam(raw, "home");
  const away = readTeam(raw, "away_team") ?? readTeam(raw, "away");

  if (id === null || !date || !home || !away) return null;
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return null;

  return {
    id,
    date,
    timestamp: Math.floor(timestamp / 1000),
    status: readString(raw, ["status"]) ?? "finished",
    competition: readCompetition(raw),
    home,
    away,
    goals: {
      home: readScore(raw, "home"),
      away: readScore(raw, "away"),
    },
  };
}

function readCountry(raw: Record<string, unknown>): string {
  const direct = readString(raw, ["country_name", "country_code"]);
  if (direct) return direct;

  if (typeof raw.country === "string") return raw.country;
  const country = asRecord(raw.country);
  return country ? readString(country, ["name", "code"]) ?? "" : "";
}

function safeErrorBody(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return String(value).slice(0, 800);
  }
}

export class BsdFootballProvider implements SportsDataProvider {
  readonly name = "BSD";

  private async request(path: string, params: Record<string, string | number> = {}) {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }

    const url = new URL(`${BSD_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Token ${apiKey}` },
        signal: controller.signal,
      });
    } catch {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não respondeu à consulta.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new AnalysisPipelineError(
        "API_LIMIT_REACHED",
        "O limite de requisições da BSD Football API foi atingido.",
      );
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // The status-specific errors below remain useful even if the body is not JSON.
    }

    if (response.status === 401) {
      console.warn("[bsd-football] authentication rejected", { path, status: response.status });
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A chave da BSD Football API não foi aceita.",
      );
    }

    if (response.status === 402 || response.status === 403) {
      console.warn("[bsd-football] entitlement rejected", {
        path,
        status: response.status,
        detail: safeErrorBody(payload),
      });
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API recusou esta consulta por permissão da conta.",
      );
    }

    if (!response.ok) {
      console.warn("[bsd-football] HTTP failure", {
        path,
        status: response.status,
        detail: safeErrorBody(payload),
      });
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `A BSD Football API retornou uma falha de serviço (HTTP ${response.status}).`,
      );
    }

    if (payload === null) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API retornou uma resposta inválida.",
      );
    }

    return payload;
  }

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    const payload = paginatedSchema.parse(
      await this.request("/teams/", { name, limit: 20 }),
    );

    const candidates = payload.results
      .map((raw) => {
        const id = readNumber(raw, ["id", "team_id"]);
        const teamName = readString(raw, ["name", "team_name"]);
        return id !== null && teamName
          ? { id, name: teamName, country: readCountry(raw) }
          : null;
      })
      .filter((team): team is ResolvedTeam => team !== null);

    if (candidates.length === 0) {
      throw new AnalysisPipelineError(
        "TEAM_NOT_FOUND",
        `Não encontramos o time "${name}" na BSD Football API.`,
      );
    }

    const target = normalize(name);
    return (
      candidates.find((team) => normalize(team.name) === target) ??
      candidates.find((team) => normalize(team.name).includes(target)) ??
      candidates[0]
    );
  }

  async getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]> {
    const payload = paginatedSchema.parse(
      await this.request("/events/", {
        team_id: teamId,
        status: "finished",
        limit: Math.min(200, Math.max(20, count * 4)),
      }),
    );

    const fixtures = payload.results
      .map(readFixture)
      .filter((fixture): fixture is ProviderFixture => fixture !== null)
      .filter((fixture) => fixture.status === "finished")
      .sort((a, b) => a.timestamp - b.timestamp);

    return fixtures.slice(-count);
  }

  async getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    const isHome = fixture.home.id === teamId;
    const isAway = fixture.away.id === teamId;
    if (!isHome && !isAway) return null;

    const goalsFor = isHome ? fixture.goals.home : fixture.goals.away;
    const goalsAgainst = isHome ? fixture.goals.away : fixture.goals.home;
    const opponent = isHome ? fixture.away.name : fixture.home.name;

    let value: number | null = null;

    if (metric === "goals") {
      value = goalsFor;
    } else {
      const payload = statsSchema.parse(
        await this.request(`/events/${fixture.id}/stats/`),
      );
      const sideStats = isHome ? payload.stats.home : payload.stats.away;

      if (metric === "corners") {
        value = readNumber(sideStats, ["corners", "corner_kicks"]);
      }

      if (metric === "shots" || metric === "shots_on_target") {
        const sideShots = payload.shotmap.filter((shot) => {
          if (readString(shot, ["sit", "situation"]) === "shootout") return false;
          const home = readBoolean(shot, "home");
          return home === null ? false : home === isHome;
        });

        if (sideShots.length > 0) {
          value =
            metric === "shots"
              ? sideShots.length
              : sideShots.filter((shot) => {
                  const type = readString(shot, ["type"]);
                  return type === "goal" || type === "save";
                }).length;
        } else {
          value =
            metric === "shots"
              ? readNumber(sideStats, ["total_shots", "shots_total"])
              : readNumber(sideStats, ["shots_on_target", "shots_on_goal"]);
        }
      }

      if (metric === "cards") {
        const yellow = readNumber(sideStats, ["yellow_cards", "cards_yellow"]);
        const red = readNumber(sideStats, ["red_cards", "cards_red"]);
        if (yellow !== null || red !== null) value = (yellow ?? 0) + (red ?? 0);
      }
    }

    if (value === null || goalsFor === null || goalsAgainst === null) return null;

    const outcome: MatchRecord["outcome"] =
      goalsFor > goalsAgainst ? "V" : goalsFor < goalsAgainst ? "D" : "E";

    return {
      id: String(fixture.id),
      date: fixture.date,
      opponent,
      competition: fixture.competition,
      venue: isHome ? "home" : "away",
      result: `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,
      outcome,
      value,
      source: this.name,
    };
  }
}

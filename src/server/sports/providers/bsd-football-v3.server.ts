import type { MatchRecord } from "@/data/sports";
import { AnalysisPipelineError } from "@/server/analysis/errors";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "../provider";
import { BsdFootballV2Provider } from "./bsd-football-v2.server";

const BSD_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TIMEOUT_MS = 15_000;

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
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readTeam(record: Record<string, unknown>, side: "home" | "away") {
  const nested = asRecord(record[`${side}_team`]) ?? asRecord(record[side]);
  if (nested) {
    const id = readNumber(nested, ["id", "team_id"]);
    const name = readString(nested, ["name", "team_name", "short_name"]);
    if (id !== null && name) return { id, name };
  }

  const id = readNumber(record, [`${side}_team_id`, `${side}_id`]);
  const name = readString(record, [
    `${side}_team`,
    `${side}_team_name`,
    `${side}_name`,
  ]);
  return id !== null && name ? { id, name } : null;
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

function readCompetition(record: Record<string, unknown>): string {
  const league = asRecord(record.league) ?? asRecord(record.competition);
  if (league) {
    const name = readString(league, ["name", "league_name", "competition_name"]);
    if (name) return name;
  }
  return readString(record, ["league_name", "competition_name"]) ?? "Competição";
}

function readDate(record: Record<string, unknown>): { date: string; timestamp: number } | null {
  const raw = readString(record, [
    "event_date",
    "start_time",
    "kickoff_at",
    "kickoff",
    "start_at",
    "date",
    "scheduled_at",
  ]);

  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return { date: raw, timestamp: Math.floor(ms / 1000) };
  }

  const unix = readNumber(record, ["start_timestamp", "timestamp", "kickoff_timestamp"]);
  if (unix !== null) {
    const ms = unix > 10_000_000_000 ? unix : unix * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return { date: date.toISOString(), timestamp: Math.floor(date.getTime() / 1000) };
    }
  }

  return null;
}

function readFixture(raw: Record<string, unknown>): ProviderFixture | null {
  const id = readNumber(raw, ["id", "event_id", "fixture_id"]);
  const when = readDate(raw);
  const home = readTeam(raw, "home");
  const away = readTeam(raw, "away");
  if (id === null || !when || !home || !away) return null;

  return {
    id,
    date: when.date,
    timestamp: when.timestamp,
    status: (readString(raw, ["status"]) ?? "").toLowerCase(),
    competition: readCompetition(raw),
    home,
    away,
    goals: {
      home: readScore(raw, "home"),
      away: readScore(raw, "away"),
    },
  };
}

function extractResults(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.results)) return [];
  return root.results
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class BsdFootballV3Provider implements SportsDataProvider {
  readonly name = "BSD";
  private readonly delegate = new BsdFootballV2Provider();

  resolveTeam(name: string): Promise<ResolvedTeam> {
    return this.delegate.resolveTeam(name);
  }

  private async fetchFinishedEvents(teamId: number, daysBack: number): Promise<ProviderFixture[]> {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }

    const dateTo = new Date();
    const dateFrom = new Date(dateTo);
    dateFrom.setUTCDate(dateFrom.getUTCDate() - daysBack);

    const url = new URL(`${BSD_BASE_URL}/events/`);
    url.searchParams.set("team_id", String(teamId));
    url.searchParams.set("status", "finished");
    url.searchParams.set("date_from", formatDate(dateFrom));
    url.searchParams.set("date_to", formatDate(dateTo));
    url.searchParams.set("limit", "200");
    url.searchParams.set("offset", "0");

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
        "A BSD Football API não respondeu ao buscar o histórico do time.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A chave da BSD Football API não foi aceita.",
      );
    }
    if (response.status === 429) {
      throw new AnalysisPipelineError(
        "API_LIMIT_REACHED",
        "O limite de requisições da BSD Football API foi atingido.",
      );
    }
    if (!response.ok) {
      console.warn("[bsd-football-v3] events HTTP failure", {
        teamId,
        status: response.status,
      });
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `A BSD Football API falhou ao buscar o histórico (HTTP ${response.status}).`,
      );
    }

    const payload: unknown = await response.json();
    return extractResults(payload)
      .map(readFixture)
      .filter((fixture): fixture is ProviderFixture => fixture !== null)
      .filter((fixture) => fixture.status === "finished")
      .filter((fixture) => fixture.home.id === teamId || fixture.away.id === teamId)
      .filter((fixture) => fixture.goals.home !== null && fixture.goals.away !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]> {
    let fixtures = await this.fetchFinishedEvents(teamId, 180);

    if (fixtures.length < count) {
      fixtures = await this.fetchFinishedEvents(teamId, 730);
    }

    console.info("[bsd-football-v3] recent fixtures resolved", {
      teamId,
      requested: count,
      available: fixtures.length,
      selectedIds: fixtures.slice(-count).map((fixture) => fixture.id),
    });

    return fixtures.slice(-count);
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    return this.delegate.getFixtureMetric(fixture, teamId, metric);
  }
}

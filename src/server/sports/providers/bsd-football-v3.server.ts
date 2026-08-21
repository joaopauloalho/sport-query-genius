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
  const name = readString(record, [`${side}_team_name`, `${side}_name`]);
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
    "start_time",
    "kickoff_at",
    "kickoff",
    "event_date",
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

function normalizedStatus(record: Record<string, unknown>): string {
  const raw = readString(record, ["status", "state", "match_status"]);
  return (raw ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

function isFinished(record: Record<string, unknown>, timestamp: number): boolean {
  const status = normalizedStatus(record);
  if (["finished", "ft", "fulltime", "ended", "complete", "completed"].includes(status)) {
    return true;
  }

  if (["notstarted", "scheduled", "upcoming", "inprogress", "live"].includes(status)) {
    return false;
  }

  return (
    timestamp * 1000 < Date.now() &&
    readScore(record, "home") !== null &&
    readScore(record, "away") !== null
  );
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
    status: isFinished(raw, when.timestamp) ? "finished" : normalizedStatus(raw) || "unknown",
    competition: readCompetition(raw),
    home,
    away,
    goals: {
      home: readScore(raw, "home"),
      away: readScore(raw, "away"),
    },
  };
}

function collectRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 3) return [];

  if (Array.isArray(value)) {
    const direct = value
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== null);
    return direct.length > 0 ? direct : value.flatMap((item) => collectRecords(item, depth + 1));
  }

  const root = asRecord(value);
  if (!root) return [];

  const priorityKeys = [
    "results",
    "fixtures",
    "events",
    "matches",
    "recent_results",
    "recent",
    "previous",
    "past",
  ];

  const priority = priorityKeys.flatMap((key) => collectRecords(root[key], depth + 1));
  if (priority.length > 0) return priority;

  return Object.values(root).flatMap((child) => collectRecords(child, depth + 1));
}

function safeShape(payload: unknown) {
  const root = asRecord(payload);
  return {
    rootType: Array.isArray(payload) ? "array" : typeof payload,
    rootKeys: root ? Object.keys(root).slice(0, 30) : [],
  };
}

export class BsdFootballV3Provider implements SportsDataProvider {
  readonly name = "BSD";
  private readonly delegate = new BsdFootballV2Provider();

  resolveTeam(name: string): Promise<ResolvedTeam> {
    return this.delegate.resolveTeam(name);
  }

  async getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]> {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(`${BSD_BASE_URL}/teams/${teamId}/fixtures/`, {
        headers: { Authorization: `Token ${apiKey}` },
        signal: controller.signal,
      });
    } catch {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não respondeu ao buscar os jogos do time.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn("[bsd-football-v3] fixtures HTTP failure", {
        teamId,
        status: response.status,
      });
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `A BSD Football API falhou ao buscar os jogos (HTTP ${response.status}).`,
      );
    }

    const payload: unknown = await response.json();
    const records = collectRecords(payload);
    const parsed = records
      .map(readFixture)
      .filter((fixture): fixture is ProviderFixture => fixture !== null)
      .filter((fixture) => fixture.status === "finished")
      .filter((fixture) => fixture.home.id === teamId || fixture.away.id === teamId)
      .sort((a, b) => a.timestamp - b.timestamp);

    console.info("[bsd-football-v3] fixtures parsed", {
      teamId,
      requested: count,
      collectedRecords: records.length,
      parsedFinished: parsed.length,
      shape: safeShape(payload),
      sampleKeys: records[0] ? Object.keys(records[0]).slice(0, 30) : [],
      sampleStatus: records[0] ? readString(records[0], ["status", "state", "match_status"]) : null,
    });

    return parsed.slice(-count);
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    return this.delegate.getFixtureMetric(fixture, teamId, metric);
  }
}

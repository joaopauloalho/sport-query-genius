import { z } from "zod";

import type { MatchRecord } from "@/data/sports";
import { AnalysisPipelineError } from "@/server/analysis/errors";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import { resolveFootballEntityCandidates } from "../entity-resolver";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "../provider";
import { BsdFootballProvider } from "./bsd-football.server";

const BSD_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TIMEOUT_MS = 15_000;

const teamsSchema = z
  .object({
    results: z.array(z.record(z.unknown())),
  })
  .passthrough();

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
  const id = readNumber(raw, ["id", "event_id"]);
  const when = readDate(raw);
  const home = readTeam(raw, "home");
  const away = readTeam(raw, "away");
  if (id === null || !when || !home || !away) return null;

  return {
    id,
    date: when.date,
    timestamp: when.timestamp,
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

function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
  }

  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["results", "fixtures", "events", "matches"]) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
    }
  }
  return [];
}

function safeBody(payload: unknown): string {
  try {
    return JSON.stringify(payload).slice(0, 1200);
  } catch {
    return String(payload).slice(0, 1200);
  }
}

export class BsdFootballV2Provider implements SportsDataProvider {
  readonly name = "BSD";
  private readonly statsDelegate = new BsdFootballProvider();

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

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // status handling below remains useful without JSON
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
      console.warn("[bsd-football-v2] HTTP failure", {
        path,
        status: response.status,
        detail: safeBody(payload),
      });
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `A BSD Football API retornou uma falha de serviço (HTTP ${response.status}).`,
      );
    }

    return payload;
  }

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    const payload = teamsSchema.parse(await this.request("/teams/", { name, limit: 20 }));

    const candidates = payload.results
      .map((raw) => {
        const id = readNumber(raw, ["id", "team_id"]);
        const teamName = readString(raw, ["name", "team_name"]);
        const country = readString(raw, ["country", "country_name", "country_code"]) ?? "";
        return id !== null && teamName ? { id, name: teamName, country } : null;
      })
      .filter((team): team is ResolvedTeam => team !== null);

    const resolution = resolveFootballEntityCandidates(name, candidates);
    if (resolution.status === "ambiguous") {
      console.warn("[bsd-football-v2] team ambiguous", {
        query: name,
        candidates: resolution.candidates.map((team) => ({ id: team.id, name: team.name, score: team.score })),
      });
      throw new AnalysisPipelineError(
        "ENTITY_AMBIGUOUS",
        `Encontramos mais de um time plausível para "${name}". Escolha um nome mais específico.`,
        resolution.candidates.map((team) => ({
          id: String(team.id),
          name: team.name,
          provider: this.name,
          context: team.country,
        })),
      );
    }

    if (resolution.status !== "resolved") {
      console.warn("[bsd-football-v2] team not found", {
        query: name,
        candidates: resolution.candidates.map((team) => ({ id: team.id, name: team.name, score: team.score })),
      });
      throw new AnalysisPipelineError(
        "TEAM_NOT_FOUND",
        `Não encontramos o time "${name}" na BSD Football API com confiança suficiente.`,
      );
    }

    const chosen = candidates.find((team) => team.id === resolution.candidate.id);
    if (!chosen) {
      throw new AnalysisPipelineError("TEAM_NOT_FOUND", `Não encontramos o time "${name}" na BSD Football API.`);
    }

    console.info("[bsd-football-v2] resolved team", {
      query: name,
      teamId: chosen.id,
      teamName: chosen.name,
      score: resolution.score,
    });
    return chosen;
  }

  async getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]> {
    const payload = await this.request(`/teams/${teamId}/fixtures/`, {
      status: "finished",
      limit: Math.min(200, Math.max(20, count * 4)),
    });

    const rawRecords = extractRecords(payload);
    const parsed = rawRecords
      .map(readFixture)
      .filter((fixture): fixture is ProviderFixture => fixture !== null)
      .filter((fixture) => fixture.status === "finished")
      .sort((a, b) => a.timestamp - b.timestamp);

    console.info("[bsd-football-v2] fixtures parsed", {
      teamId,
      rawCount: rawRecords.length,
      parsedCount: parsed.length,
      requested: count,
      sampleKeys: rawRecords[0] ? Object.keys(rawRecords[0]).slice(0, 25) : [],
    });

    return parsed.slice(-count);
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    return this.statsDelegate.getFixtureMetric(fixture, teamId, metric);
  }
}

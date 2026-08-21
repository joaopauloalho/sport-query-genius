import { z } from "zod";

import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import { AnalysisPipelineError } from "@/server/analysis/errors";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "../provider";

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 15_000;

const teamSearchSchema = z.object({
  response: z.array(
    z.object({
      team: z.object({
        id: z.number().int().positive(),
        name: z.string(),
        country: z.string().nullable().optional(),
      }),
    }),
  ),
  errors: z.unknown().optional(),
});

const fixturesSchema = z.object({
  response: z.array(
    z.object({
      fixture: z.object({
        id: z.number().int().positive(),
        date: z.string(),
        timestamp: z.number(),
        status: z.object({ short: z.string() }),
      }),
      league: z.object({ name: z.string() }),
      teams: z.object({
        home: z.object({ id: z.number(), name: z.string() }),
        away: z.object({ id: z.number(), name: z.string() }),
      }),
      goals: z.object({
        home: z.number().nullable(),
        away: z.number().nullable(),
      }),
    }),
  ),
  errors: z.unknown().optional(),
});

const fixtureStatisticsSchema = z.object({
  response: z.array(
    z.object({
      team: z.object({ id: z.number() }),
      statistics: z.array(
        z.object({
          type: z.string(),
          value: z.union([z.number(), z.string(), z.null()]),
        }),
      ),
    }),
  ),
  errors: z.unknown().optional(),
});

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function hasApiErrors(errors: unknown): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors as Record<string, unknown>).length > 0;
  return Boolean(errors);
}

export class ApiFootballProvider implements SportsDataProvider {
  readonly name = "API-FOOTBALL";

  private async request(path: "/teams" | "/fixtures" | "/fixtures/statistics", params: Record<string, string | number>) {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A API-FOOTBALL não está configurada no servidor.",
      );
    }

    const url = new URL(`${API_FOOTBALL_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "x-apisports-key": apiKey },
        signal: controller.signal,
      });
    } catch {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A API-FOOTBALL não respondeu à consulta.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new AnalysisPipelineError(
        "API_LIMIT_REACHED",
        "O limite de requisições da API-FOOTBALL foi atingido.",
      );
    }

    if (!response.ok) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `A API-FOOTBALL retornou uma falha de serviço (HTTP ${response.status}).`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A API-FOOTBALL retornou uma resposta inválida.",
      );
    }

    const errorCarrier = z.object({ errors: z.unknown().optional() }).safeParse(payload);
    if (errorCarrier.success && hasApiErrors(errorCarrier.data.errors)) {
      const serialized = JSON.stringify(errorCarrier.data.errors).toLowerCase();
      if (serialized.includes("request") || serialized.includes("limit") || serialized.includes("rate")) {
        throw new AnalysisPipelineError(
          "API_LIMIT_REACHED",
          "O limite de requisições da API-FOOTBALL foi atingido.",
        );
      }
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A API-FOOTBALL recusou a consulta solicitada.",
      );
    }

    return payload;
  }

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    const payload = teamSearchSchema.parse(
      await this.request("/teams", { search: name }),
    );

    if (payload.response.length === 0) {
      throw new AnalysisPipelineError(
        "TEAM_NOT_FOUND",
        `Não encontramos o time "${name}" na API-FOOTBALL.`,
      );
    }

    const target = normalize(name);
    const exact =
      payload.response.find((entry) => normalize(entry.team.name) === target) ??
      payload.response.find((entry) => normalize(entry.team.name).includes(target)) ??
      payload.response[0];

    return {
      id: exact.team.id,
      name: exact.team.name,
      country: exact.team.country ?? "",
    };
  }

  async getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]> {
    const payload = fixturesSchema.parse(
      await this.request("/fixtures", { team: teamId, last: count }),
    );

    return payload.response
      .map((entry) => ({
        id: entry.fixture.id,
        date: entry.fixture.date,
        timestamp: entry.fixture.timestamp,
        status: entry.fixture.status.short,
        competition: entry.league.name,
        home: entry.teams.home,
        away: entry.teams.away,
        goals: entry.goals,
      }))
      .filter((fixture) => ["FT", "AET", "PEN"].includes(fixture.status))
      .sort((a, b) => a.timestamp - b.timestamp);
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
      const payload = fixtureStatisticsSchema.parse(
        await this.request("/fixtures/statistics", {
          fixture: fixture.id,
          team: teamId,
        }),
      );
      const teamBlock =
        payload.response.find((entry) => entry.team.id === teamId) ??
        payload.response[0];

      if (!teamBlock) return null;

      const getNumericStat = (type: string): number | null => {
        const raw = teamBlock.statistics.find((item) => item.type === type)?.value;
        if (typeof raw === "number") return raw;
        if (typeof raw === "string") {
          const parsed = Number(raw.replace("%", "").trim());
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      };

      if (metric === "corners") value = getNumericStat("Corner Kicks");
      if (metric === "shots") value = getNumericStat("Total Shots");
      if (metric === "shots_on_target") value = getNumericStat("Shots on Goal");
      if (metric === "cards") {
        const yellow = getNumericStat("Yellow Cards");
        const red = getNumericStat("Red Cards");
        value = yellow === null || red === null ? null : yellow + red;
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

import { z } from "zod";

import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import { AnalysisPipelineError } from "@/server/analysis/errors";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "../provider";
import {
  classifyApiFootballError,
  getApiFootballErrorPayload,
  type ApiFootballErrorKind,
} from "./api-football-errors";

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 15_000;
const COMPLETED_FIXTURE_STATUSES = ["FT", "AET", "PEN"] as const;

type ApiFootballAuthHeader = "x-apisports-key" | "x-rapidapi-key";

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

const formatApiDate = (date: Date) => date.toISOString().slice(0, 10);

function safeErrorForLog(errors: unknown, apiKey: string): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(errors);
  } catch {
    serialized = String(errors);
  }

  return serialized.replaceAll(apiKey, "[redacted]").slice(0, 800);
}

function pipelineErrorFor(kind: ApiFootballErrorKind): AnalysisPipelineError {
  if (kind === "account") {
    return new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "A conta da API-FOOTBALL está suspensa, desativada ou inativa. O servidor não tentou contornar essa restrição.",
    );
  }
  if (kind === "limit") {
    return new AnalysisPipelineError(
      "API_LIMIT_REACHED",
      "O limite de requisições da API-FOOTBALL foi atingido.",
    );
  }
  if (kind === "auth") {
    return new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "A chave da API-FOOTBALL não foi aceita. Confirme se a chave é da API-Sports/API-FOOTBALL ou do RapidAPI.",
    );
  }
  if (kind === "plan") {
    return new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "A API-FOOTBALL recusou esta consulta por restrição do plano, assinatura ou entitlement.",
    );
  }
  if (kind === "parameter") {
    return new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "A API-FOOTBALL recusou um parâmetro da consulta. O servidor registrou o motivo de forma sanitizada.",
    );
  }
  return new AnalysisPipelineError(
    "PROVIDER_UNAVAILABLE",
    "A API-FOOTBALL recusou a consulta solicitada.",
  );
}

function classifyHttpFailure(status: number, payload: unknown): ApiFootballErrorKind {
  const errorPayload = getApiFootballErrorPayload(payload);
  if (errorPayload !== null) {
    const classified = classifyApiFootballError(errorPayload);
    if (classified !== "provider") return classified;
  }

  if (status === 401) return "auth";
  if (status === 402) return "plan";
  if (status === 403) return "auth";
  return "provider";
}

export class ApiFootballProvider implements SportsDataProvider {
  readonly name = "API-FOOTBALL";

  private async request(
    path: "/teams" | "/fixtures" | "/fixtures/statistics",
    params: Record<string, string | number>,
  ) {
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

    const performRequest = async (authHeader: ApiFootballAuthHeader) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { [authHeader]: apiKey },
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

      let payload: unknown = null;
      let hasJsonPayload = false;
      try {
        payload = await response.json();
        hasJsonPayload = true;
      } catch {
        // Status-specific handling below remains useful even without JSON.
      }

      if (response.status === 429) {
        throw new AnalysisPipelineError(
          "API_LIMIT_REACHED",
          "O limite de requisições da API-FOOTBALL foi atingido.",
        );
      }

      if (!response.ok) {
        const kind = classifyHttpFailure(response.status, payload);
        console.warn("[api-football] HTTP failure", {
          path,
          authHeader,
          status: response.status,
          kind,
          remaining: response.headers.get("x-ratelimit-requests-remaining"),
          detail: safeErrorForLog(payload, apiKey),
        });
        throw pipelineErrorFor(kind);
      }

      if (!hasJsonPayload) {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          "A API-FOOTBALL retornou uma resposta inválida.",
        );
      }

      return {
        payload,
        remaining: response.headers.get("x-ratelimit-requests-remaining"),
      };
    };

    let result = await performRequest("x-apisports-key");
    let errorPayload = getApiFootballErrorPayload(result.payload);

    if (errorPayload !== null) {
      const kind = classifyApiFootballError(errorPayload);

      console.warn("[api-football] API error", {
        path,
        authHeader: "x-apisports-key",
        kind,
        remaining: result.remaining,
        detail: safeErrorForLog(errorPayload, apiKey),
      });

      // API-Sports currently documents x-apisports-key. Older/RapidAPI-issued keys can use
      // x-rapidapi-key against the same allow-listed API host. Retry only when the response
      // specifically indicates an authentication/header mismatch. Account suspension,
      // entitlement, rate limits and normal provider errors are never retried this way.
      if (kind === "auth") {
        result = await performRequest("x-rapidapi-key");
        errorPayload = getApiFootballErrorPayload(result.payload);

        if (errorPayload === null) {
          console.info("[api-football] alternate auth header accepted", {
            path,
            authHeader: "x-rapidapi-key",
            remaining: result.remaining,
          });
          return result.payload;
        }

        const fallbackKind = classifyApiFootballError(errorPayload);
        console.warn("[api-football] API error after auth fallback", {
          path,
          authHeader: "x-rapidapi-key",
          kind: fallbackKind,
          remaining: result.remaining,
          detail: safeErrorForLog(errorPayload, apiKey),
        });
        throw pipelineErrorFor(fallbackKind);
      }

      throw pipelineErrorFor(kind);
    }

    return result.payload;
  }

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    const payload = teamSearchSchema.parse(await this.request("/teams", { search: name }));

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
    const to = new Date();
    const currentSeason = to.getUTCFullYear();

    const loadCompletedFixtures = async (season: number, from: Date, until: Date) => {
      const payload = fixturesSchema.parse(
        await this.request("/fixtures", {
          team: teamId,
          season,
          from: formatApiDate(from),
          to: formatApiDate(until),
          status: COMPLETED_FIXTURE_STATUSES.join("-"),
        }),
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
        .filter((fixture) =>
          COMPLETED_FIXTURE_STATUSES.includes(
            fixture.status as (typeof COMPLETED_FIXTURE_STATUSES)[number],
          ),
        )
        .sort((a, b) => a.timestamp - b.timestamp);
    };

    const currentFrom = new Date(to);
    currentFrom.setUTCDate(currentFrom.getUTCDate() - 120);

    // The API-FOOTBALL Free plan rejects the convenience `last` parameter and requires
    // `season` when team + date filters are used. Query the current season explicitly,
    // then fall back to the prior season only when necessary.
    let fixtures = await loadCompletedFixtures(currentSeason, currentFrom, to);

    if (fixtures.length < count) {
      const previousSeason = currentSeason - 1;
      const previousFrom = new Date(Date.UTC(previousSeason, 0, 1));
      const previousTo = new Date(Date.UTC(previousSeason, 11, 31, 23, 59, 59));
      const previousFixtures = await loadCompletedFixtures(
        previousSeason,
        previousFrom,
        previousTo,
      );

      const byFixtureId = new Map<number, ProviderFixture>();
      for (const fixture of [...previousFixtures, ...fixtures]) {
        byFixtureId.set(fixture.id, fixture);
      }
      fixtures = [...byFixtureId.values()].sort((a, b) => a.timestamp - b.timestamp);
    }

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
      const payload = fixtureStatisticsSchema.parse(
        await this.request("/fixtures/statistics", {
          fixture: fixture.id,
          team: teamId,
        }),
      );
      const teamBlock =
        payload.response.find((entry) => entry.team.id === teamId) ?? payload.response[0];

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

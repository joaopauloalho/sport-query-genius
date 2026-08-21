import { z } from "zod";

import { AnalysisPipelineError } from "@/server/analysis/errors";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type { MatchRecord } from "@/data/sports";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "../provider";
import { BsdFootballProvider } from "./bsd-football.server";

const BSD_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TIMEOUT_MS = 15_000;

const teamsSchema = z
  .object({
    results: z.array(
      z.object({
        id: z.number().int().positive(),
        name: z.string(),
        country: z.string().nullable().optional(),
        country_code: z.string().nullable().optional(),
      }).passthrough(),
    ),
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

export class BsdFootballSearchProvider implements SportsDataProvider {
  readonly name = "BSD";
  private readonly delegate = new BsdFootballProvider();

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }

    const url = new URL(`${BSD_BASE_URL}/teams/`);
    url.searchParams.set("search", name);
    url.searchParams.set("limit", "20");

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
        "A BSD Football API não respondeu à busca do time.",
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

    if (!response.ok) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `A BSD Football API retornou uma falha ao buscar o time (HTTP ${response.status}).`,
      );
    }

    const payload = teamsSchema.parse(await response.json());
    const target = normalize(name);
    const exact = payload.results.find((team) => normalize(team.name) === target);
    const partial = payload.results.find((team) => normalize(team.name).includes(target));
    const chosen = exact ?? partial;

    if (!chosen) {
      console.warn("[bsd-football] team search returned no matching team", {
        query: name,
        candidates: payload.results.slice(0, 10).map((team) => ({ id: team.id, name: team.name })),
      });
      throw new AnalysisPipelineError(
        "TEAM_NOT_FOUND",
        `Não encontramos o time "${name}" na BSD Football API.`,
      );
    }

    console.info("[bsd-football] resolved team", {
      query: name,
      teamId: chosen.id,
      teamName: chosen.name,
      country: chosen.country ?? chosen.country_code ?? "",
    });

    return {
      id: chosen.id,
      name: chosen.name,
      country: chosen.country ?? chosen.country_code ?? "",
    };
  }

  getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]> {
    return this.delegate.getRecentTeamFixtures(teamId, count);
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    return this.delegate.getFixtureMetric(fixture, teamId, metric);
  }
}

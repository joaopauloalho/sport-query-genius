import { AnalysisPipelineError } from "@/server/analysis/errors";
import { resolveFootballEntityCandidates } from "@/server/sports/entity-resolver";
import type { ResolvedTeam } from "@/server/sports/provider";
import { ApiFootballProvider } from "./api-football.server";

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 15_000;

type AuthHeader = "x-apisports-key" | "x-rapidapi-key";

type TeamSearchPayload = {
  response?: Array<{
    team?: { id?: number; name?: string; country?: string | null };
  }>;
  errors?: unknown;
};

function hasApiErrors(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function authHeaders(authHeader: AuthHeader, apiKey: string): Record<string, string> {
  if (authHeader === "x-rapidapi-key") {
    return {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    };
  }
  return { "x-apisports-key": apiKey };
}

export class SafeApiFootballProvider extends ApiFootballProvider {
  async resolveTeam(name: string): Promise<ResolvedTeam> {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A API-FOOTBALL não está configurada no servidor.",
      );
    }

    const url = new URL(`${API_FOOTBALL_BASE_URL}/teams`);
    url.searchParams.set("search", name);

    const perform = async (authHeader: AuthHeader): Promise<TeamSearchPayload> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: authHeaders(authHeader, apiKey),
          signal: controller.signal,
        });
      } catch {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          "A API-FOOTBALL não respondeu à busca de times.",
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

      let payload: TeamSearchPayload;
      try {
        payload = (await response.json()) as TeamSearchPayload;
      } catch {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          "A API-FOOTBALL retornou uma resposta inválida na busca de times.",
        );
      }

      if (!response.ok || hasApiErrors(payload.errors)) {
        if (authHeader === "x-apisports-key") return perform("x-rapidapi-key");
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          "A API-FOOTBALL recusou a busca de times.",
        );
      }
      return payload;
    };

    const payload = await perform("x-apisports-key");
    const candidates = (payload.response ?? [])
      .map((entry) => {
        const id = entry.team?.id;
        const teamName = entry.team?.name?.trim();
        if (!Number.isInteger(id) || !teamName) return null;
        return {
          id: id as number,
          name: teamName,
          country: entry.team?.country ?? "",
        };
      })
      .filter((team): team is ResolvedTeam => team !== null);

    const resolution = resolveFootballEntityCandidates(name, candidates);
    if (resolution.status === "ambiguous") {
      throw new AnalysisPipelineError(
        "ENTITY_AMBIGUOUS",
        `Encontramos mais de um time plausível para "${name}" na API-FOOTBALL. Escolha um nome mais específico.`,
        resolution.candidates.map((team) => ({
          id: String(team.id),
          name: team.name,
          provider: this.name,
          context: team.country,
        })),
      );
    }
    if (resolution.status !== "resolved") {
      throw new AnalysisPipelineError(
        "TEAM_NOT_FOUND",
        `Não encontramos o time "${name}" na API-FOOTBALL com confiança suficiente.`,
      );
    }

    const chosen = candidates.find((team) => team.id === resolution.candidate.id);
    if (!chosen) {
      throw new AnalysisPipelineError(
        "TEAM_NOT_FOUND",
        `Não encontramos o time "${name}" na API-FOOTBALL.`,
      );
    }
    return chosen;
  }
}

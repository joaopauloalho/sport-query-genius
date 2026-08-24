import { AnalysisPipelineError } from "@/server/analysis/errors";
import { resolveFootballEntityCandidates } from "@/server/sports/entity-resolver";
import type { ResolvedTeam } from "@/server/sports/provider";
import {
  classifyApiFootballError,
  getApiFootballErrorPayload,
  type ApiFootballErrorKind,
} from "./api-football-errors";
import { ApiFootballProvider } from "./api-football.server";

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 15_000;

type AuthHeader = "x-apisports-key" | "x-rapidapi-key";

type TeamSearchPayload = {
  response?: Array<{
    team?: { id?: number; name?: string; country?: string | null };
  }>;
  errors?: unknown;
  error?: unknown;
  message?: unknown;
};

function authHeaders(authHeader: AuthHeader, apiKey: string): Record<string, string> {
  if (authHeader === "x-rapidapi-key") {
    return {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    };
  }
  return { "x-apisports-key": apiKey };
}

function safeErrorForLog(value: unknown, apiKey: string): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  return serialized.replaceAll(apiKey, "[redacted]").slice(0, 800);
}

function classifyFailure(status: number, payload: unknown): ApiFootballErrorKind {
  const errorPayload = getApiFootballErrorPayload(payload);
  if (errorPayload !== null) {
    const classified = classifyApiFootballError(errorPayload);
    if (classified !== "provider") return classified;
  }
  if (status === 429) return "limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "plan";
  return "provider";
}

function teamSearchErrorFor(kind: ApiFootballErrorKind): AnalysisPipelineError {
  if (kind === "account") {
    return new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "A conta da API-FOOTBALL está suspensa, desativada ou inativa.",
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
      "A chave da API-FOOTBALL não foi aceita na busca de times.",
    );
  }
  if (kind === "plan") {
    return new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "A API-FOOTBALL recusou a busca de times por restrição do plano ou assinatura.",
    );
  }
  if (kind === "parameter") {
    return new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "A API-FOOTBALL recusou um parâmetro da busca de times.",
    );
  }
  return new AnalysisPipelineError(
    "PROVIDER_UNAVAILABLE",
    "A API-FOOTBALL recusou a busca de times.",
  );
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

      let payload: TeamSearchPayload;
      try {
        payload = (await response.json()) as TeamSearchPayload;
      } catch {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          "A API-FOOTBALL retornou uma resposta inválida na busca de times.",
        );
      }

      const errorPayload = getApiFootballErrorPayload(payload);
      if (!response.ok || errorPayload !== null) {
        const kind = classifyFailure(response.status, payload);
        console.warn("[api-football-safe] team search failure", {
          authHeader,
          status: response.status,
          kind,
          remaining: response.headers.get("x-ratelimit-requests-remaining"),
          detail: safeErrorForLog(errorPayload ?? payload, apiKey),
        });

        // Retry with RapidAPI headers only when the response explicitly indicates an
        // authentication/header mismatch. Retrying account/plan/limit/provider failures
        // only burns quota and cannot make those failures valid.
        if (authHeader === "x-apisports-key" && kind === "auth") {
          return perform("x-rapidapi-key");
        }
        throw teamSearchErrorFor(kind);
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

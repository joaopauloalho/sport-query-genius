import type { MatchRecord } from "@/data/sports";
import type { QueryIntent } from "@/lib/analysis";
import { ApiFootballProvider } from "@/server/sports/providers/api-football.server";
import { BsdFootballV2Provider } from "@/server/sports/providers/bsd-football-v2.server";

import { parseIntentWithDeepSeek } from "./deepseek.server";
import { buildRealAnalysisResult } from "./engine.server";
import { AnalysisPipelineError, toSafeAnalysisError, type ServerAnalysisOutcome } from "./errors";

function createFootballProvider() {
  if (process.env.BSD_FOOTBALL_KEY) return new BsdFootballV2Provider();
  return new ApiFootballProvider();
}

export async function analyzeQuestionServer(question: string): Promise<ServerAnalysisOutcome> {
  try {
    const parsedIntent = await parseIntentWithDeepSeek(question);

    if (parsedIntent.venue !== "all") {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_FILTER",
        "Filtros de casa/fora serão habilitados na Fase 2. Nesta POC use todos os jogos.",
      );
    }

    if (parsedIntent.competition !== null) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_FILTER",
        "Filtro por competição será habilitado na Fase 2. Nesta POC use todas as competições.",
      );
    }

    const provider = createFootballProvider();
    const team = await provider.resolveTeam(parsedIntent.entity_name);
    const fixtures = await provider.getRecentTeamFixtures(team.id, parsedIntent.match_count);

    if (fixtures.length < parsedIntent.match_count) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A ${provider.name} retornou apenas ${fixtures.length} partidas concluídas para a amostra pedida.`,
      );
    }

    const matches: MatchRecord[] = [];
    for (const fixture of fixtures.slice(-parsedIntent.match_count)) {
      const match = await provider.getFixtureMetric(fixture, team.id, parsedIntent.metric);
      if (match) matches.push(match);
    }

    if (matches.length < parsedIntent.match_count) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A ${provider.name} não forneceu a estatística "${parsedIntent.metric}" em todas as ${parsedIntent.match_count} partidas. Nenhum valor ausente foi estimado.`,
      );
    }

    const metricLabels = {
      corners: "Escanteios",
      goals: "Gols marcados",
      shots: "Finalizações",
      shots_on_target: "Finalizações no alvo",
      cards: "Cartões",
    } as const;

    const intent: QueryIntent = {
      ...parsedIntent,
      entity_name: team.name,
      entity_id: String(team.id),
      metric_label: metricLabels[parsedIntent.metric],
      compare_with: null,
    };

    return {
      ok: true,
      result: buildRealAnalysisResult({
        question,
        intent,
        matches,
        provider: provider.name,
      }),
    };
  } catch (error) {
    const safe = toSafeAnalysisError(error);
    return { ok: false, code: safe.code, reason: safe.reason };
  }
}

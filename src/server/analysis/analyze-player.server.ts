import type { MatchRecord } from "@/data/sports";
import {
  buildCacheKey,
  type AnalysisGoalEvent,
  type EventListAnalysisResult,
  type EventListQueryIntent,
  type QueryIntent,
} from "@/lib/analysis";
import type { SportsCacheObserver } from "@/server/sports/cache/cache-observer";
import { getPhase3dSportsRepository } from "@/server/sports/phase3d-repository.server";
import { PlayerDataService } from "@/server/sports/player-data-service.server";
import { playerMetricValue, type PlayerMetric } from "@/server/sports/player-provider";
import { BsdPlayerProvider } from "@/server/sports/providers/bsd-player-enriched.server";

import { buildRealAnalysisResult } from "./engine.server";
import { AnalysisPipelineError } from "./errors";
import type { PlayerAggregateIntentInput, PlayerEventListIntentInput } from "./intent-schema";

const PLAYER_METRIC_LABELS = {
  goals: "Gols marcados",
  shots: "Finalizações",
  shots_on_target: "Finalizações no alvo",
  cards: "Cartões",
} as const;

export interface ResolvedCompetitionFilter {
  intentValue: string | null;
  providerNames: readonly string[] | null;
}

function outcomeFromResult(result: string, venue: "home" | "away"): "V" | "E" | "D" {
  const match = result.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!match) return "E";
  const home = Number(match[1]);
  const away = Number(match[2]);
  const own = venue === "home" ? home : away;
  const opponent = venue === "home" ? away : home;
  return own > opponent ? "V" : own < opponent ? "D" : "E";
}

function buildMatchRecord(
  stat: Awaited<ReturnType<PlayerDataService["getRecentParticipatedStats"]>>[number],
  metric: PlayerMetric,
): MatchRecord {
  const value = playerMetricValue(stat, metric);
  if (value === null) throw new Error("Cannot build a match record from a missing player metric");
  return {
    id: String(stat.fixtureId),
    date: stat.date,
    opponent: stat.opponentName,
    competition: stat.competition,
    venue: stat.venue,
    result: stat.result,
    outcome: outcomeFromResult(stat.result, stat.venue),
    value,
    source: stat.source,
  };
}

function createPlayerService(observer?: SportsCacheObserver): PlayerDataService {
  return new PlayerDataService(new BsdPlayerProvider(), getPhase3dSportsRepository(), observer);
}

export async function analyzePlayerAggregate(params: {
  question: string;
  intent: PlayerAggregateIntentInput;
  competition: ResolvedCompetitionFilter;
  observer?: SportsCacheObserver;
}) {
  const service = createPlayerService(params.observer);
  const player = await service.resolvePlayer(params.intent.entity_name);
  const selected = await service.getRecentParticipatedStats(
    player,
    params.intent.match_count,
    params.competition.providerNames,
  );
  if (selected.length < params.intent.match_count) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `A BSD retornou apenas ${selected.length} partida(s) com participação registrada de ${player.name} para a amostra pedida de ${params.intent.match_count}. Jogos com 0 minutos e sem contribuição registrada não foram usados para completar a amostra.`,
    );
  }

  const hydrated = await service.ensureMetric(
    player,
    selected,
    params.intent.metric as PlayerMetric,
  );
  const missing = hydrated.filter(
    (stat) => playerMetricValue(stat, params.intent.metric as PlayerMetric) === null,
  );
  if (missing.length > 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `A BSD não forneceu a métrica "${params.intent.metric}" em ${missing.length} das ${hydrated.length} partidas selecionadas de ${player.name}. null foi preservado como dado ausente; nenhum valor foi convertido para zero.`,
    );
  }

  const intent: QueryIntent = {
    sport: "football",
    query_kind: "aggregate",
    entity_type: "player",
    entity_name: player.name,
    entity_id: String(player.id),
    compare_with: null,
    metric: params.intent.metric,
    metric_label: PLAYER_METRIC_LABELS[params.intent.metric],
    aggregation: params.intent.aggregation,
    match_count: params.intent.match_count,
    competition: params.competition.intentValue,
    venue: "all",
  };
  const matches = hydrated.map((stat) =>
    buildMatchRecord(stat, params.intent.metric as PlayerMetric),
  );
  const result = buildRealAnalysisResult({
    question: params.question,
    intent,
    matches,
    provider: "BSD",
  });
  return {
    ...result,
    player: {
      name: player.name,
      team_name: player.teamName,
      position: player.position,
    },
  };
}

export async function analyzePlayerEventList(params: {
  question: string;
  intent: PlayerEventListIntentInput;
  competition: ResolvedCompetitionFilter;
  observer?: SportsCacheObserver;
}): Promise<EventListAnalysisResult> {
  const service = createPlayerService(params.observer);
  const player = await service.resolvePlayer(params.intent.entity_name);
  const events = await service.getRecentGoalEvents(
    player,
    params.intent.event_count,
    params.competition.providerNames,
  );
  if (events.length < params.intent.event_count) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `A BSD permitiu comprovar ${events.length} evento(s) individualizado(s) de gol de ${player.name}, abaixo dos ${params.intent.event_count} pedidos. Nenhum gol foi criado a partir de totais por partida.`,
    );
  }

  const intent: EventListQueryIntent = {
    sport: "football",
    query_kind: "event_list",
    entity_type: "player",
    entity_name: player.name,
    entity_id: String(player.id),
    metric: "goals",
    metric_label: "Gols",
    event_type: "goal",
    event_count: params.intent.event_count,
    competition: params.competition.intentValue,
    venue: "all",
  };
  const mapped: AnalysisGoalEvent[] = events.slice(0, params.intent.event_count).map((event) => ({
    event_key: event.eventKey,
    fixture_id: String(event.fixtureId),
    date: event.date,
    opponent: event.opponentName,
    competition: event.competition,
    venue: event.venue,
    result: event.result,
    minute: event.minute,
    extra_time: event.extraTime,
    situation: event.situation,
    body_part: event.bodyPart,
    xg: event.xg,
    xg_estimated: event.xgEstimated,
    source: event.source,
  }));
  const cacheKey = buildCacheKey(intent);
  const now = new Date().toISOString();

  return {
    result_type: "event_list",
    id: `${cacheKey}-${Date.now()}`,
    cache_key: cacheKey,
    question: params.question,
    created_at: now,
    intent,
    player: { name: player.name, team_name: player.teamName, position: player.position },
    events: mapped,
    related: [
      `Quantos gols ${player.name} marcou nos últimos 10 jogos?`,
      `Qual foi a média de finalizações de ${player.name} nos últimos 5 jogos?`,
      `Qual foi a média de finalizações no alvo de ${player.name} nos últimos 5 jogos?`,
    ],
    source: {
      provider: "BSD",
      updated_at: now,
      missing: mapped.filter((event) => event.minute === null).length,
    },
    demo: false,
  };
}

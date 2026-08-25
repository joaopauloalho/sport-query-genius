import {
  toCsv as legacyToCsv,
  type AnalysisResult as LegacyAnalysisResult,
  type EventListAnalysisResult,
} from "./analysis";
import type {
  HeadToHeadAnalysisResult,
  MatchListAnalysisResult,
  TeamEventListAnalysisResult,
  UniversalAnalysisResult,
} from "./universal-analysis";

export type AnalysisResult = LegacyAnalysisResult | UniversalAnalysisResult;
export type AnyEventListAnalysisResult = EventListAnalysisResult | TeamEventListAnalysisResult;

export function isPlayerEventListAnalysisResult(
  result: AnalysisResult,
): result is EventListAnalysisResult {
  return result.result_type === "event_list" && "player" in result;
}

export function isTeamEventListAnalysisResult(
  result: AnalysisResult,
): result is TeamEventListAnalysisResult {
  return result.result_type === "event_list" && "team" in result;
}

export function isEventListAnalysisResult(
  result: AnalysisResult,
): result is AnyEventListAnalysisResult {
  return isTeamEventListAnalysisResult(result) || isPlayerEventListAnalysisResult(result);
}

export function isMatchListAnalysisResult(
  result: AnalysisResult,
): result is MatchListAnalysisResult {
  return result.result_type === "match_list";
}

export function isHeadToHeadAnalysisResult(
  result: AnalysisResult,
): result is HeadToHeadAnalysisResult {
  return result.result_type === "head_to_head";
}

export function analysisResultSummary(result: AnalysisResult): string {
  if (isTeamEventListAnalysisResult(result)) {
    return `${result.events.length} evento(s) · ${result.team.name}`;
  }
  if (isPlayerEventListAnalysisResult(result)) {
    return `${result.events.length} gols · ${result.player.name}`;
  }
  if (isMatchListAnalysisResult(result)) {
    return `${result.matches.length} partida(s) · ${result.player?.name ?? result.team.name}`;
  }
  if (isHeadToHeadAnalysisResult(result)) {
    return `${result.summary.meetings} confronto(s) · ${result.teams.primary.name} × ${result.teams.compare.name}`;
  }
  return `${result.statistics.sample_size} jogos · resultado ${result.answer.value}`;
}

function csv(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

export function toCsv(result: AnalysisResult): string {
  if (isTeamEventListAnalysisResult(result)) {
    return csv([
      [
        "data",
        "evento",
        "jogador",
        "jogador_secundario",
        "adversario",
        "competicao",
        "mando",
        "resultado",
        "minuto",
        "acrescimo",
        "detalhe",
        "situacao",
        "parte_corpo",
        "xg",
        "fonte",
      ],
      ...result.events.map((event) => [
        new Date(event.date).toLocaleDateString("pt-BR"),
        event.event_type,
        event.player_name,
        event.secondary_player_name,
        event.opponent,
        event.competition,
        event.venue === "home" ? "Casa" : "Fora",
        event.result,
        event.minute,
        event.extra_time,
        event.detail,
        event.situation,
        event.body_part,
        event.xg,
        event.source,
      ]),
    ]);
  }

  if (isMatchListAnalysisResult(result)) {
    return csv([
      [
        "data",
        "mandante",
        "visitante",
        "competicao",
        "status",
        "placar",
        "mando",
        "metrica",
        "valor",
        "unidade",
        "fonte",
      ],
      ...result.matches.map((match) => [
        new Date(match.date).toLocaleDateString("pt-BR"),
        match.home_team.name,
        match.away_team.name,
        match.competition,
        match.status,
        match.result,
        match.venue === "home" ? "Casa" : "Fora",
        match.metric?.key ?? null,
        match.metric?.value ?? null,
        match.metric?.unit ?? null,
        match.source,
      ]),
    ]);
  }

  if (isHeadToHeadAnalysisResult(result)) {
    return csv([
      ["data", "mandante", "visitante", "competicao", "placar", "fonte"],
      ...result.meetings.map((match) => [
        new Date(match.date).toLocaleDateString("pt-BR"),
        match.home_team.name,
        match.away_team.name,
        match.competition,
        match.result,
        match.source,
      ]),
    ]);
  }

  return legacyToCsv(result as LegacyAnalysisResult);
}

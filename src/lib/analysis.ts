/**
 * Shared analysis contracts plus the legacy deterministic demo engine.
 * Real football analysis is executed server-side under src/server/.
 */

import {
  COMPETITIONS,
  DATA_SOURCE,
  PLAYERS,
  TEAMS,
  generateMatches,
  getCompetition,
  getSport,
  type MatchRecord,
  type MetricDef,
  type SportId,
} from "@/data/sports";

export interface QueryIntent {
  sport: SportId;
  query_kind?: "aggregate";
  entity_type: "team" | "player";
  entity_name: string;
  entity_id: string;
  compare_with?: { entity_name: string; entity_id: string } | null;
  metric: string;
  metric_label: string;
  aggregation: "average" | "total" | "median";
  match_count: number;
  competition: string | null;
  venue: "all" | "home" | "away";
}

export interface EventListQueryIntent {
  sport: "football";
  query_kind: "event_list";
  entity_type: "player";
  entity_name: string;
  entity_id: string;
  metric: "goals";
  metric_label: string;
  event_type: "goal";
  event_count: number;
  competition: string | null;
  venue: "all";
}

export type AnalysisIntent = QueryIntent | EventListQueryIntent;

export interface AnalysisStatistics {
  average: number;
  median: number;
  total: number;
  maximum: number;
  minimum: number;
  sample_size: number;
  trend: number;
}

export interface AnalysisPlayerContext {
  name: string;
  team_name: string | null;
  position: string | null;
}

export interface AggregateAnalysisResult {
  result_type?: "aggregate";
  id: string;
  cache_key: string;
  question: string;
  created_at: string;
  intent: QueryIntent;
  player?: AnalysisPlayerContext;
  answer: { value: number; unit: string; summary: string; explanation: string };
  statistics: AnalysisStatistics;
  chart_data: { label: string; value: number; opponent: string; venue: string; compare?: number }[];
  matches: MatchRecord[];
  compare_matches?: MatchRecord[];
  insights: string[];
  related: string[];
  source: { provider: string; updated_at: string; missing: number };
  demo: boolean;
}

export interface AnalysisGoalEvent {
  event_key: string;
  fixture_id: string;
  date: string;
  opponent: string;
  competition: string;
  venue: "home" | "away";
  result: string;
  minute: number | null;
  extra_time: number | null;
  situation: string | null;
  body_part: string | null;
  xg: number | null;
  xg_estimated: boolean | null;
  source: string;
}

export interface EventListAnalysisResult {
  result_type: "event_list";
  id: string;
  cache_key: string;
  question: string;
  created_at: string;
  intent: EventListQueryIntent;
  player: AnalysisPlayerContext;
  events: AnalysisGoalEvent[];
  related: string[];
  source: { provider: string; updated_at: string; missing: number };
  demo: false;
}

export type AnalysisResult = AggregateAnalysisResult | EventListAnalysisResult;

export function isEventListAnalysisResult(result: AnalysisResult): result is EventListAnalysisResult {
  return result.result_type === "event_list";
}

export type AnalysisOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; reason: string };

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Equivalent aggregate requests retain the historical v1 cache key. */
export function buildCacheKey(intent: AnalysisIntent): string {
  if (intent.query_kind === "event_list") {
    return [
      "v2",
      intent.sport,
      intent.entity_type,
      intent.entity_id,
      "event_list",
      intent.event_type,
      intent.event_count,
      intent.competition ?? "all",
    ].join("|");
  }

  return [
    "v1",
    intent.sport,
    intent.entity_type,
    intent.entity_id,
    intent.compare_with?.entity_id ?? "-",
    intent.metric,
    intent.aggregation,
    intent.match_count,
    intent.competition ?? "all",
    intent.venue,
  ].join("|");
}

/** Legacy demo parser. The real server pipeline does not call this function. */
export function parseIntent(question: string): QueryIntent | null {
  const q = normalize(question);

  const entities = [
    ...TEAMS.map((t) => ({ id: t.id, name: t.name, type: "team" as const, sport: "football" as SportId, competitionId: t.competitionId })),
    ...PLAYERS.map((p) => ({ id: p.id, name: p.name, type: "player" as const, sport: p.sport, competitionId: p.competitionId })),
  ];

  const found = entities
    .map((e) => ({ e, idx: q.indexOf(normalize(e.name)) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (found.length === 0) return null;

  const primary = found[0].e;
  const secondary = found.find((x) => x.e.id !== primary.id && x.e.type === primary.type)?.e ?? null;
  const sport = primary.sport;
  const metrics = getSport(sport).metrics;
  const metric: MetricDef =
    metrics.find((m) => m.aliases.some((a) => q.includes(normalize(a)))) ?? metrics[0];
  const countMatch =
    q.match(/(?:ultim[oa]s?|last)\s+(\d{1,3})/) ??
    q.match(/(\d{1,3})\s*(?:jogos|partidas|games)/);
  const match_count = Math.min(50, Math.max(3, countMatch ? parseInt(countMatch[1], 10) : 10));
  const venue: QueryIntent["venue"] = /fora de casa|visitante|away/.test(q)
    ? "away"
    : /em casa|mandante|home/.test(q)
      ? "home"
      : "all";
  const aggregation: QueryIntent["aggregation"] = /total|quantos no total|soma/.test(q)
    ? "total"
    : /mediana/.test(q)
      ? "median"
      : "average";
  const competition = COMPETITIONS.find((c) => q.includes(normalize(c.name)))?.id ?? null;

  return {
    sport,
    query_kind: "aggregate",
    entity_type: primary.type,
    entity_name: primary.name,
    entity_id: primary.id,
    compare_with: secondary ? { entity_name: secondary.name, entity_id: secondary.id } : null,
    metric: metric.key,
    metric_label: metric.label,
    aggregation,
    match_count,
    competition,
    venue,
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (n: number) => Math.round(n * 10) / 10;

function fetchMatches(intent: QueryIntent, entityId: string, entityName: string): MatchRecord[] {
  const metric = getSport(intent.sport).metrics.find((m) => m.key === intent.metric)!;
  const competitionName =
    getCompetition(intent.competition)?.name ??
    getCompetition(
      TEAMS.find((t) => t.id === entityId)?.competitionId ??
        PLAYERS.find((p) => p.id === entityId)?.competitionId,
    )?.name ??
    "Competição demonstrativa";

  const all = generateMatches({
    entityId,
    sport: intent.sport,
    metric,
    count: intent.match_count + 8,
    competitionName,
  });
  const filtered = intent.venue === "all" ? all : all.filter((m) => m.venue === intent.venue);
  void entityName;
  return filtered.slice(-intent.match_count);
}

/** Legacy demo engine. Real Phase 3D football analysis never calls this function. */
export function runAnalysis(question: string): AnalysisOutcome {
  const intent = parseIntent(question);
  if (!intent) {
    return {
      ok: false,
      reason:
        "Não encontramos dados suficientes para responder essa pergunta com confiança. Tente alterar o período, a competição ou a estatística.",
    };
  }

  const matches = fetchMatches(intent, intent.entity_id, intent.entity_name);
  if (matches.length < 3) {
    return {
      ok: false,
      reason:
        "Não encontramos dados suficientes para responder essa pergunta com confiança. Tente alterar o período, a competição ou a estatística.",
    };
  }

  const compareMatches = intent.compare_with
    ? fetchMatches(intent, intent.compare_with.entity_id, intent.compare_with.entity_name)
    : undefined;
  const values = matches.map((m) => m.value);
  const metric = getSport(intent.sport).metrics.find((m) => m.key === intent.metric)!;
  const total = values.reduce((a, b) => a + b, 0);
  const average = total / values.length;
  const last5 = values.slice(-5);
  const last5Avg = last5.reduce((a, b) => a + b, 0) / last5.length;
  const trend = round(last5Avg - average);
  const homeVals = matches.filter((m) => m.venue === "home").map((m) => m.value);
  const awayVals = matches.filter((m) => m.venue === "away").map((m) => m.value);
  const homeAvg = homeVals.length ? homeVals.reduce((a, b) => a + b, 0) / homeVals.length : 0;
  const awayAvg = awayVals.length ? awayVals.reduce((a, b) => a + b, 0) / awayVals.length : 0;
  const aboveAvgLast10 = matches.slice(-10).filter((m) => m.value > average).length;
  const best = matches.reduce((a, b) => (b.value > a.value ? b : a));

  const statistics: AnalysisStatistics = {
    average: round(average),
    median: round(median(values)),
    total: round(total),
    maximum: Math.max(...values),
    minimum: Math.min(...values),
    sample_size: values.length,
    trend,
  };
  const headline =
    intent.aggregation === "total"
      ? statistics.total
      : intent.aggregation === "median"
        ? statistics.median
        : statistics.average;
  const venueLabel =
    intent.venue === "home"
      ? " em jogos como mandante"
      : intent.venue === "away"
        ? " em jogos fora de casa"
        : "";
  const compareAvg = compareMatches
    ? round(compareMatches.reduce((a, b) => a + b.value, 0) / compareMatches.length)
    : null;
  const summary = compareAvg
    ? `${intent.entity_name} registrou ${statistics.average} ${metric.unit} contra ${compareAvg} de ${intent.compare_with!.entity_name} nos últimos ${statistics.sample_size} jogos analisados.`
    : `${intent.entity_name} teve ${headline} ${metric.unit}${venueLabel} nos últimos ${statistics.sample_size} jogos analisados.`;
  const insights = [
    trend > 0
      ? `A média subiu ${Math.abs(trend)} nos últimos cinco jogos em relação ao período completo.`
      : trend < 0
        ? `A média caiu ${Math.abs(trend)} nos últimos cinco jogos em relação ao período completo.`
        : "A média dos últimos cinco jogos está alinhada com o período completo.",
    homeVals.length && awayVals.length
      ? homeAvg >= awayAvg
        ? `O desempenho foi superior como mandante (${round(homeAvg)} contra ${round(awayAvg)} fora de casa).`
        : `O desempenho foi superior fora de casa (${round(awayAvg)} contra ${round(homeAvg)} como mandante).`
      : "A amostra contém jogos de apenas um mando de campo.",
    `${aboveAvgLast10} dos últimos ${Math.min(10, matches.length)} jogos ficaram acima da média do período.`,
    `A maior marca do período (${best.value}) ocorreu contra ${best.opponent}.`,
  ];
  const related = [
    `Ver apenas jogos em casa do ${intent.entity_name}`,
    `Ver apenas jogos fora de casa do ${intent.entity_name}`,
    `Alterar para últimos 10 jogos de ${intent.entity_name} em ${metric.label.toLowerCase()}`,
  ];
  const chart_data = matches.map((m, i) => ({
    label: new Date(m.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    value: m.value,
    opponent: m.opponent,
    venue: m.venue === "home" ? "Casa" : "Fora",
    compare: compareMatches?.[i]?.value,
  }));
  const cache_key = buildCacheKey(intent);

  return {
    ok: true,
    result: {
      result_type: "aggregate",
      id: `${cache_key}-${Date.now()}`,
      cache_key,
      question,
      created_at: new Date().toISOString(),
      intent,
      answer: {
        value: headline,
        unit: metric.unit,
        summary,
        explanation: `Cálculo feito sobre ${statistics.sample_size} partidas${venueLabel} registradas pelo ${DATA_SOURCE.provider}. Mediana de ${statistics.median}, máximo de ${statistics.maximum} e mínimo de ${statistics.minimum} no período.`,
      },
      statistics,
      chart_data,
      matches: [...matches].reverse(),
      compare_matches: compareMatches,
      insights,
      related,
      source: { provider: DATA_SOURCE.provider, updated_at: DATA_SOURCE.updatedAt, missing: 0 },
      demo: true,
    },
  };
}

export const PROCESSING_STEPS = [
  "Entendendo sua pergunta",
  "Identificando jogadores, equipes e competição",
  "Consultando dados disponíveis",
  "Calculando estatísticas",
  "Preparando a análise",
];

export function toCsv(result: AnalysisResult): string {
  if (isEventListAnalysisResult(result)) {
    const head = [
      "data",
      "adversario",
      "competicao",
      "mando",
      "resultado",
      "minuto",
      "acrescimo",
      "situacao",
      "parte_corpo",
      "xg",
      "fonte",
    ];
    const rows = result.events.map((event) => [
      new Date(event.date).toLocaleDateString("pt-BR"),
      event.opponent,
      event.competition,
      event.venue === "home" ? "Casa" : "Fora",
      event.result,
      event.minute === null ? "" : String(event.minute),
      event.extra_time === null ? "" : String(event.extra_time),
      event.situation ?? "",
      event.body_part ?? "",
      event.xg === null ? "" : String(event.xg),
      event.source,
    ]);
    return [head, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  }

  const head = [
    "data",
    "adversario",
    "competicao",
    "mando",
    "resultado",
    result.intent.metric_label,
    "fonte",
  ];
  const rows = result.matches.map((match) => [
    new Date(match.date).toLocaleDateString("pt-BR"),
    match.opponent,
    match.competition,
    match.venue === "home" ? "Casa" : "Fora",
    match.result,
    String(match.value),
    match.source,
  ]);
  return [head, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
}

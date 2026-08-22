import type {
  AggregateAnalysisResult,
  AnalysisStatistics,
  QueryIntent,
} from "@/lib/analysis";
import { buildCacheKey } from "@/lib/analysis";
import { calculateStatistics, calculateTrend } from "@/lib/statistics";
import type { MatchRecord } from "@/data/sports";

const METRIC_META = {
  corners: { label: "Escanteios", unit: "escanteios" },
  goals: { label: "Gols marcados", unit: "gols" },
  shots: { label: "Finalizações", unit: "finalizações" },
  shots_on_target: { label: "Finalizações no alvo", unit: "finalizações no alvo" },
  cards: { label: "Cartões", unit: "cartões" },
} as const;

function buildSummary(intent: QueryIntent, statistics: AnalysisStatistics, unit: string): string {
  const venueLabel =
    intent.venue === "home"
      ? " como mandante"
      : intent.venue === "away"
        ? " fora de casa"
        : "";

  if (intent.aggregation === "total") {
    return `${intent.entity_name} somou ${statistics.total} ${unit}${venueLabel} nos últimos ${statistics.sample_size} jogos analisados.`;
  }
  if (intent.aggregation === "median") {
    return `A mediana de ${unit} de ${intent.entity_name} foi ${statistics.median}${venueLabel} nos últimos ${statistics.sample_size} jogos analisados.`;
  }
  return `A média de ${unit} de ${intent.entity_name} foi ${statistics.average}${venueLabel} nos últimos ${statistics.sample_size} jogos analisados.`;
}

export function buildRealAnalysisResult(params: {
  question: string;
  intent: QueryIntent;
  matches: MatchRecord[];
  provider: string;
}): AggregateAnalysisResult {
  const { question, intent, matches, provider } = params;
  const values = matches.map((match) => match.value);
  const basic = calculateStatistics(values);
  const statistics: AnalysisStatistics = {
    ...basic,
    trend: calculateTrend(values),
  };
  const meta = METRIC_META[intent.metric as keyof typeof METRIC_META];

  if (!meta) throw new Error(`Unsupported metric in deterministic engine: ${intent.metric}`);

  const headline =
    intent.aggregation === "total"
      ? statistics.total
      : intent.aggregation === "median"
        ? statistics.median
        : statistics.average;
  const chart_data = [...matches]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((match) => ({
      label: new Date(match.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      value: match.value,
      opponent: match.opponent,
      venue: match.venue === "home" ? "Casa" : "Fora",
    }));
  const best = matches.reduce((current, match) => (match.value > current.value ? match : current));
  const aboveAverage = matches.filter((match) => match.value > statistics.average).length;
  const insights = [
    `${aboveAverage} de ${statistics.sample_size} partidas ficaram acima da média de ${statistics.average}.`,
    `A maior marca foi ${best.value} contra ${best.opponent}.`,
    `Amplitude do período: ${statistics.maximum - statistics.minimum} (${statistics.minimum} a ${statistics.maximum}).`,
  ];
  const cache_key = buildCacheKey(intent);
  const updatedAt = new Date().toISOString();

  return {
    result_type: "aggregate",
    id: `${cache_key}-${Date.now()}`,
    cache_key,
    question,
    created_at: new Date().toISOString(),
    intent,
    answer: {
      value: headline,
      unit: meta.unit,
      summary: buildSummary(intent, statistics, meta.unit),
      explanation: `Cálculo determinístico feito sobre ${statistics.sample_size} partidas retornadas pela ${provider}. Soma ${statistics.total}, mediana ${statistics.median}, máximo ${statistics.maximum} e mínimo ${statistics.minimum}.`,
    },
    statistics,
    chart_data,
    matches: [...matches].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    insights,
    related: [
      `Qual foi o total de ${meta.label.toLowerCase()} de ${intent.entity_name} nos últimos ${intent.match_count} jogos?`,
      `Qual foi a média de ${meta.label.toLowerCase()} de ${intent.entity_name} nos últimos 10 jogos?`,
      `Qual foi a mediana de ${meta.label.toLowerCase()} de ${intent.entity_name} nos últimos ${intent.match_count} jogos?`,
    ],
    source: { provider, updated_at: updatedAt, missing: 0 },
    demo: false,
  };
}

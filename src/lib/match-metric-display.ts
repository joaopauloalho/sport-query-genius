export interface MatchMetricDisplayValue {
  key: string;
  value: number;
  unit: string;
  observed: true;
}

const MATCH_METRIC_LABELS: Record<string, string> = {
  shots: "Finalizações",
  shots_on_target: "Finalizações no alvo",
  shots_off_target: "Finalizações para fora",
  blocked_shots: "Finalizações bloqueadas",
  shots_inside_box: "Finalizações dentro da área",
  shots_outside_box: "Finalizações fora da área",
  hit_woodwork: "Bolas na trave",
  big_chances: "Grandes chances",
  big_chances_scored: "Grandes chances convertidas",
  big_chances_missed: "Grandes chances perdidas",
  xg: "xG",
  offsides: "Impedimentos",
  corners: "Escanteios",
  passes: "Passes",
  accurate_passes: "Passes certos",
  pass_accuracy: "Precisão de passe",
  crosses: "Cruzamentos",
  possession: "Posse de bola",
  duels: "Duelos",
  duels_won: "Duelos ganhos",
  dribbles: "Dribles",
  tackles: "Desarmes",
  interceptions: "Interceptações",
  clearances: "Cortes",
  fouls: "Faltas",
  yellow_cards: "Cartões amarelos",
  red_cards: "Cartões vermelhos",
  cards: "Cartões",
  saves: "Defesas",
};

function fallbackMetricLabel(key: string): string {
  const normalized = key.replace(/_/g, " ").trim();
  if (!normalized) return "Métrica";
  return normalized.charAt(0).toLocaleUpperCase("pt-BR") + normalized.slice(1);
}

function formatMetricNumber(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function unitSuffix(unit: string): string {
  if (unit === "percentage" || unit === "%") return " %";
  if (unit === "minutes") return " min";
  if (unit === "count" || unit === "goals" || unit === "rating" || unit === "") return "";
  return ` ${unit}`;
}

export function formatMatchMetric(metric: MatchMetricDisplayValue | null | undefined): string | null {
  if (!metric || metric.observed !== true || !Number.isFinite(metric.value)) return null;

  const label = MATCH_METRIC_LABELS[metric.key] ?? fallbackMetricLabel(metric.key);
  return `${label}: ${formatMetricNumber(metric.value)}${unitSuffix(metric.unit)}`;
}

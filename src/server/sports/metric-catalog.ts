export const TEAM_METRIC_KEYS = [
  "goals_for",
  "goals_against",
  "goal_difference",
  "wins",
  "draws",
  "losses",
  "points",
  "win_rate",
  "unbeaten_rate",
  "clean_sheets",
  "failed_to_score",
  "both_teams_scored",
  "shots",
  "shots_on_target",
  "shots_off_target",
  "blocked_shots",
  "shots_inside_box",
  "shots_outside_box",
  "hit_woodwork",
  "big_chances",
  "big_chances_scored",
  "big_chances_missed",
  "xg",
  "touches_in_box",
  "final_third_entries",
  "offsides",
  "corners",
  "passes",
  "accurate_passes",
  "pass_accuracy",
  "long_balls",
  "accurate_long_balls",
  "crosses",
  "accurate_crosses",
  "possession",
  "duels",
  "duels_won",
  "ground_duels",
  "ground_duels_won",
  "aerial_duels",
  "aerial_duels_won",
  "dribbles",
  "successful_dribbles",
  "dispossessed",
  "tackles",
  "tackles_won",
  "interceptions",
  "clearances",
  "recoveries",
  "fouls",
  "yellow_cards",
  "red_cards",
  "cards",
  "saves",
  "big_saves",
  "goals_prevented",
] as const;

export const PLAYER_METRIC_KEYS = [
  "minutes",
  "goals",
  "assists",
  "shots",
  "shots_on_target",
  "shots_off_target",
  "blocked_shots",
  "rating",
  "passes",
  "accurate_passes",
  "pass_accuracy",
  "key_passes",
  "crosses",
  "accurate_crosses",
  "long_balls",
  "accurate_long_balls",
  "duels",
  "duels_won",
  "ground_duels",
  "ground_duels_won",
  "aerial_duels",
  "aerial_duels_won",
  "dribbles",
  "successful_dribbles",
  "dispossessed",
  "tackles",
  "tackles_won",
  "interceptions",
  "clearances",
  "recoveries",
  "fouls",
  "fouls_drawn",
  "yellow_cards",
  "red_cards",
  "cards",
  "xg",
  "xgot",
  "big_chances",
  "big_chances_scored",
  "big_chances_missed",
  "saves",
  "big_saves",
  "goals_prevented",
] as const;

export const FOOTBALL_METRIC_KEYS = [
  ...TEAM_METRIC_KEYS,
  ...PLAYER_METRIC_KEYS.filter(
    (metric) => !(TEAM_METRIC_KEYS as readonly string[]).includes(metric),
  ),
] as unknown as [
  (typeof TEAM_METRIC_KEYS)[number] | (typeof PLAYER_METRIC_KEYS)[number],
  ...Array<(typeof TEAM_METRIC_KEYS)[number] | (typeof PLAYER_METRIC_KEYS)[number]>,
];

export type TeamMetric = (typeof TEAM_METRIC_KEYS)[number];
export type PlayerMetricKey = (typeof PLAYER_METRIC_KEYS)[number];
export type FootballMetric = TeamMetric | PlayerMetricKey;
export type MetricEntityType = "team" | "player";
export type MetricDataFamily =
  | "fixture_score"
  | "fixture_stats"
  | "shotmap"
  | "player_match_stats"
  | "incidents";

export type MetricProvider = "BSD" | "API_FOOTBALL";

export interface MetricProviderMapping {
  dataFamily: MetricDataFamily;
  endpoint: string;
  fields: readonly string[];
  coverage: "core" | "conditional";
}

export interface FootballMetricDefinition {
  key: FootballMetric;
  entities: readonly MetricEntityType[];
  label: string;
  unit: "count" | "percentage" | "rating" | "minutes" | "goals";
  kind: "raw" | "derived" | "transitional";
  aliases: readonly string[];
  nullable: boolean;
  providers: Partial<Record<MetricProvider, MetricProviderMapping>>;
}

const bsdStats = (
  fields: readonly string[],
  coverage: "core" | "conditional" = "conditional",
): MetricProviderMapping => ({
  dataFamily: "fixture_stats",
  endpoint: "/events/{event_id}/stats/",
  fields,
  coverage,
});

const apiStats = (
  fields: readonly string[],
  coverage: "core" | "conditional" = "conditional",
): MetricProviderMapping => ({
  dataFamily: "fixture_stats",
  endpoint: "/fixtures/statistics",
  fields,
  coverage,
});

const scoreMapping = (provider: MetricProvider): MetricProviderMapping => ({
  dataFamily: "fixture_score",
  endpoint: provider === "BSD" ? "/events/" : "/fixtures",
  fields: ["home_score", "away_score"],
  coverage: "core",
});

const playerStats = (fields: readonly string[]): MetricProviderMapping => ({
  dataFamily: "player_match_stats",
  endpoint: "/events/{event_id}/player-stats/",
  fields,
  coverage: "conditional",
});

const definition = (
  key: FootballMetric,
  entities: readonly MetricEntityType[],
  label: string,
  aliases: readonly string[],
  options: Partial<Pick<FootballMetricDefinition, "unit" | "kind" | "nullable" | "providers">> = {},
): FootballMetricDefinition => ({
  key,
  entities,
  label,
  unit: options.unit ?? "count",
  kind: options.kind ?? "raw",
  aliases,
  nullable: options.nullable ?? true,
  providers: options.providers ?? {},
});

const scoreDerived = (
  key: TeamMetric,
  label: string,
  aliases: readonly string[],
  unit: FootballMetricDefinition["unit"] = "count",
): FootballMetricDefinition =>
  definition(key, ["team"], label, aliases, {
    unit,
    kind: "derived",
    nullable: false,
    providers: {
      BSD: scoreMapping("BSD"),
      API_FOOTBALL: scoreMapping("API_FOOTBALL"),
    },
  });

const TEAM_DEFINITIONS: FootballMetricDefinition[] = [
  scoreDerived("goals_for", "Gols marcados", ["gols", "gols marcados", "fez gols", "marcou gols"]),
  scoreDerived("goals_against", "Gols sofridos", ["gols sofridos", "levou gols", "tomou gols"]),
  scoreDerived("goal_difference", "Saldo de gols", ["saldo", "saldo de gols"]),
  scoreDerived("wins", "Vitórias", ["vitorias", "vitórias", "jogos ganhos"]),
  scoreDerived("draws", "Empates", ["empates", "jogos empatados"]),
  scoreDerived("losses", "Derrotas", ["derrotas", "jogos perdidos"]),
  scoreDerived("points", "Pontos", ["pontos"]),
  scoreDerived(
    "win_rate",
    "Taxa de vitórias",
    ["aproveitamento", "taxa de vitorias", "percentual de vitorias"],
    "percentage",
  ),
  scoreDerived(
    "unbeaten_rate",
    "Taxa de invencibilidade",
    ["invicto", "taxa sem perder", "invencibilidade"],
    "percentage",
  ),
  scoreDerived("clean_sheets", "Jogos sem sofrer gol", [
    "clean sheet",
    "clean sheets",
    "nao tomou gol",
    "não sofreu gol",
  ]),
  scoreDerived("failed_to_score", "Jogos sem marcar", [
    "nao marcou",
    "não fez gol",
    "passou em branco",
  ]),
  scoreDerived("both_teams_scored", "Ambos marcaram", ["ambos marcam", "btts", "os dois marcaram"]),
  definition(
    "shots",
    ["team"],
    "Finalizações",
    ["chutes", "finalizacoes", "finalizações", "arremates"],
    {
      providers: {
        BSD: bsdStats(["total_shots", "shots_total"], "core"),
        API_FOOTBALL: apiStats(["Total Shots"], "core"),
      },
    },
  ),
  definition(
    "shots_on_target",
    ["team"],
    "Finalizações no alvo",
    ["chutes certos", "chutes no gol", "finalizacoes certas", "finalizações no alvo"],
    {
      providers: {
        BSD: bsdStats(["shots_on_target", "shots_on_goal"], "core"),
        API_FOOTBALL: apiStats(["Shots on Goal"], "core"),
      },
    },
  ),
  definition(
    "shots_off_target",
    ["team"],
    "Finalizações para fora",
    ["chutes para fora", "finalizacoes para fora"],
    {
      providers: {
        BSD: bsdStats(["shots_off_target"], "conditional"),
        API_FOOTBALL: apiStats(["Shots off Goal"], "core"),
      },
    },
  ),
  definition(
    "blocked_shots",
    ["team"],
    "Finalizações bloqueadas",
    ["chutes bloqueados", "finalizacoes bloqueadas"],
    {
      providers: {
        BSD: bsdStats(["blocked_shots"]),
        API_FOOTBALL: apiStats(["Blocked Shots"], "core"),
      },
    },
  ),
  definition(
    "shots_inside_box",
    ["team"],
    "Finalizações dentro da área",
    ["chutes dentro da area", "finalizacoes na area"],
    { providers: { API_FOOTBALL: apiStats(["Shots insidebox"]) } },
  ),
  definition(
    "shots_outside_box",
    ["team"],
    "Finalizações fora da área",
    ["chutes de fora", "finalizacoes fora da area"],
    { providers: { API_FOOTBALL: apiStats(["Shots outsidebox"]) } },
  ),
  definition(
    "hit_woodwork",
    ["team"],
    "Bolas na trave",
    ["bola na trave", "trave", "acertou a trave"],
    { providers: { BSD: bsdStats(["hit_woodwork"]) } },
  ),
  definition("big_chances", ["team"], "Grandes chances", ["grandes chances", "big chances"], {
    providers: { BSD: bsdStats(["big_chances"]) },
  }),
  definition(
    "big_chances_scored",
    ["team"],
    "Grandes chances convertidas",
    ["grandes chances marcadas", "big chances scored"],
    { providers: { BSD: bsdStats(["big_chances_scored"]) } },
  ),
  definition(
    "big_chances_missed",
    ["team"],
    "Grandes chances perdidas",
    ["grandes chances perdidas", "big chances missed"],
    { providers: { BSD: bsdStats(["big_chances_missed"]) } },
  ),
  definition("xg", ["team"], "xG", ["xg", "expected goals", "gols esperados"], {
    providers: { BSD: bsdStats(["xg"]) },
  }),
  definition("touches_in_box", ["team"], "Toques na área", ["toques na area", "touches in box"]),
  definition("final_third_entries", ["team"], "Entradas no terço final", [
    "entradas no terco final",
    "final third entries",
  ]),
  definition("offsides", ["team"], "Impedimentos", ["impedimentos", "offsides"], {
    providers: {
      BSD: bsdStats(["offsides"], "core"),
      API_FOOTBALL: apiStats(["Offsides"], "core"),
    },
  }),
  definition(
    "corners",
    ["team"],
    "Escanteios",
    ["escanteios", "cantos", "tiros de canto", "corners"],
    {
      providers: {
        BSD: bsdStats(["corners", "corner_kicks"], "core"),
        API_FOOTBALL: apiStats(["Corner Kicks"], "core"),
      },
    },
  ),
  definition("passes", ["team"], "Passes", ["passes", "passes tentados"], {
    providers: {
      BSD: bsdStats(["passes", "total_passes"]),
      API_FOOTBALL: apiStats(["Total passes"], "core"),
    },
  }),
  definition(
    "accurate_passes",
    ["team"],
    "Passes certos",
    ["passes certos", "passes completos", "passes precisos"],
    {
      providers: {
        BSD: bsdStats(["accurate_passes"]),
        API_FOOTBALL: apiStats(["Passes accurate"], "core"),
      },
    },
  ),
  definition(
    "pass_accuracy",
    ["team"],
    "Precisão de passe",
    ["precisao de passe", "acerto de passe", "pass accuracy"],
    {
      unit: "percentage",
      providers: { BSD: bsdStats(["pass_accuracy"]), API_FOOTBALL: apiStats(["Passes %"], "core") },
    },
  ),
  definition("long_balls", ["team"], "Bolas longas", ["bolas longas", "lancamentos longos"]),
  definition("accurate_long_balls", ["team"], "Bolas longas certas", [
    "bolas longas certas",
    "lancamentos longos certos",
  ]),
  definition("crosses", ["team"], "Cruzamentos", ["cruzamentos", "crosses"], {
    providers: { BSD: bsdStats(["crosses"]) },
  }),
  definition("accurate_crosses", ["team"], "Cruzamentos certos", [
    "cruzamentos certos",
    "accurate crosses",
  ]),
  definition("possession", ["team"], "Posse de bola", ["posse", "posse de bola"], {
    unit: "percentage",
    providers: {
      BSD: bsdStats(["ball_possession", "possession"], "core"),
      API_FOOTBALL: apiStats(["Ball Possession"], "core"),
    },
  }),
  definition("duels", ["team"], "Duelos", ["duelos"], { providers: { BSD: bsdStats(["duels"]) } }),
  definition("duels_won", ["team"], "Duelos ganhos", ["duelos ganhos", "duelos vencidos"], {
    providers: { BSD: bsdStats(["duels_won"]) },
  }),
  definition("ground_duels", ["team"], "Duelos no chão", ["duelos no chao"]),
  definition("ground_duels_won", ["team"], "Duelos no chão ganhos", ["duelos no chao ganhos"]),
  definition("aerial_duels", ["team"], "Duelos aéreos", ["duelos aereos"]),
  definition("aerial_duels_won", ["team"], "Duelos aéreos ganhos", ["duelos aereos ganhos"]),
  definition("dribbles", ["team"], "Dribles", ["dribles", "tentativas de drible"], {
    providers: { BSD: bsdStats(["dribbles"]) },
  }),
  definition("successful_dribbles", ["team"], "Dribles certos", [
    "dribles certos",
    "dribles completos",
  ]),
  definition("dispossessed", ["team"], "Perdas de posse", ["perdeu a posse", "desarmado"]),
  definition("tackles", ["team"], "Desarmes", ["desarmes", "tackles"], {
    providers: { BSD: bsdStats(["tackles"]) },
  }),
  definition("tackles_won", ["team"], "Desarmes ganhos", ["desarmes certos", "tackles won"]),
  definition("interceptions", ["team"], "Interceptações", ["interceptacoes", "interceptações"], {
    providers: { BSD: bsdStats(["interceptions"]) },
  }),
  definition("clearances", ["team"], "Cortes", ["cortes", "afastamentos", "clearances"], {
    providers: { BSD: bsdStats(["clearances"]) },
  }),
  definition("recoveries", ["team"], "Recuperações", ["recuperacoes", "recuperações de bola"]),
  definition("fouls", ["team"], "Faltas", ["faltas", "faltas cometidas"], {
    providers: { BSD: bsdStats(["fouls"], "core"), API_FOOTBALL: apiStats(["Fouls"], "core") },
  }),
  definition(
    "yellow_cards",
    ["team"],
    "Cartões amarelos",
    ["cartoes amarelos", "amarelos", "cartão amarelo"],
    {
      providers: {
        BSD: bsdStats(["yellow_cards", "cards_yellow"], "core"),
        API_FOOTBALL: apiStats(["Yellow Cards"], "core"),
      },
    },
  ),
  definition(
    "red_cards",
    ["team"],
    "Cartões vermelhos",
    ["cartoes vermelhos", "vermelhos", "expulsoes"],
    {
      providers: {
        BSD: bsdStats(["red_cards", "cards_red"], "core"),
        API_FOOTBALL: apiStats(["Red Cards"], "core"),
      },
    },
  ),
  definition("cards", ["team"], "Cartões", ["cartoes", "cartões"], {
    kind: "transitional",
    providers: {
      BSD: bsdStats(["yellow_cards", "red_cards"], "core"),
      API_FOOTBALL: apiStats(["Yellow Cards", "Red Cards"], "core"),
    },
  }),
  definition("saves", ["team"], "Defesas", ["defesas", "saves"], {
    providers: { API_FOOTBALL: apiStats(["Goalkeeper Saves"], "core") },
  }),
  definition("big_saves", ["team"], "Grandes defesas", ["grandes defesas", "big saves"]),
  definition("goals_prevented", ["team"], "Gols evitados", ["gols evitados", "goals prevented"]),
];

const PLAYER_DEFINITIONS: FootballMetricDefinition[] = [
  definition("minutes", ["player"], "Minutos", ["minutos", "tempo jogado"], {
    unit: "minutes",
    providers: { BSD: playerStats(["minutes", "minutes_played"]) },
  }),
  definition("goals", ["player"], "Gols", ["gols", "marcou", "fez gol"], {
    unit: "goals",
    providers: { BSD: playerStats(["goals"]) },
  }),
  definition(
    "assists",
    ["player"],
    "Assistências",
    ["assistencias", "assistências", "passes para gol"],
    { providers: { BSD: playerStats(["assists"]) } },
  ),
  definition(
    "shots",
    ["player"],
    "Finalizações",
    ["chutes", "finalizacoes", "finalizações", "arremates"],
    { providers: { BSD: playerStats(["shots", "total_shots"]) } },
  ),
  definition(
    "shots_on_target",
    ["player"],
    "Finalizações no alvo",
    ["chutes certos", "chutes no gol", "finalizacoes no alvo"],
    { providers: { BSD: playerStats(["shots_on_target", "shots_on_goal"]) } },
  ),
  definition(
    "shots_off_target",
    ["player"],
    "Finalizações para fora",
    ["chutes para fora", "finalizacoes para fora"],
    { providers: { BSD: playerStats(["shots_off_target"]) } },
  ),
  definition("blocked_shots", ["player"], "Finalizações bloqueadas", ["chutes bloqueados"], {
    providers: { BSD: playerStats(["blocked_shots"]) },
  }),
  definition("rating", ["player"], "Nota", ["nota", "rating", "avaliacao"], {
    unit: "rating",
    providers: { BSD: playerStats(["rating"]) },
  }),
  definition("passes", ["player"], "Passes", ["passes"], {
    providers: { BSD: playerStats(["passes", "total_passes"]) },
  }),
  definition(
    "accurate_passes",
    ["player"],
    "Passes certos",
    ["passes certos", "passes completos"],
    { providers: { BSD: playerStats(["accurate_passes"]) } },
  ),
  definition(
    "pass_accuracy",
    ["player"],
    "Precisão de passe",
    ["precisao de passe", "pass accuracy"],
    { unit: "percentage", providers: { BSD: playerStats(["pass_accuracy"]) } },
  ),
  definition("key_passes", ["player"], "Passes decisivos", ["passes decisivos", "key passes"], {
    providers: { BSD: playerStats(["key_passes"]) },
  }),
  definition("crosses", ["player"], "Cruzamentos", ["cruzamentos"], {
    providers: { BSD: playerStats(["crosses"]) },
  }),
  definition("accurate_crosses", ["player"], "Cruzamentos certos", ["cruzamentos certos"], {
    providers: { BSD: playerStats(["accurate_crosses"]) },
  }),
  definition("long_balls", ["player"], "Bolas longas", ["bolas longas"], {
    providers: { BSD: playerStats(["long_balls"]) },
  }),
  definition("accurate_long_balls", ["player"], "Bolas longas certas", ["bolas longas certas"], {
    providers: { BSD: playerStats(["accurate_long_balls"]) },
  }),
  definition("duels", ["player"], "Duelos", ["duelos"], {
    providers: { BSD: playerStats(["duels"]) },
  }),
  definition("duels_won", ["player"], "Duelos ganhos", ["duelos ganhos", "duelos vencidos"], {
    providers: { BSD: playerStats(["duels_won"]) },
  }),
  definition("ground_duels", ["player"], "Duelos no chão", ["duelos no chao"], {
    providers: { BSD: playerStats(["ground_duels"]) },
  }),
  definition("ground_duels_won", ["player"], "Duelos no chão ganhos", ["duelos no chao ganhos"], {
    providers: { BSD: playerStats(["ground_duels_won"]) },
  }),
  definition("aerial_duels", ["player"], "Duelos aéreos", ["duelos aereos"], {
    providers: { BSD: playerStats(["aerial_duels"]) },
  }),
  definition("aerial_duels_won", ["player"], "Duelos aéreos ganhos", ["duelos aereos ganhos"], {
    providers: { BSD: playerStats(["aerial_duels_won"]) },
  }),
  definition("dribbles", ["player"], "Dribles", ["dribles"], {
    providers: { BSD: playerStats(["dribbles"]) },
  }),
  definition("successful_dribbles", ["player"], "Dribles certos", ["dribles certos"], {
    providers: { BSD: playerStats(["successful_dribbles"]) },
  }),
  definition("dispossessed", ["player"], "Perdas de posse", ["perdas de posse", "desarmado"], {
    providers: { BSD: playerStats(["dispossessed"]) },
  }),
  definition("tackles", ["player"], "Desarmes", ["desarmes", "tackles"], {
    providers: { BSD: playerStats(["tackles"]) },
  }),
  definition("tackles_won", ["player"], "Desarmes ganhos", ["desarmes certos"], {
    providers: { BSD: playerStats(["tackles_won"]) },
  }),
  definition("interceptions", ["player"], "Interceptações", ["interceptacoes", "interceptações"], {
    providers: { BSD: playerStats(["interceptions"]) },
  }),
  definition("clearances", ["player"], "Cortes", ["cortes", "afastamentos"], {
    providers: { BSD: playerStats(["clearances"]) },
  }),
  definition("recoveries", ["player"], "Recuperações", ["recuperacoes", "recuperações"], {
    providers: { BSD: playerStats(["recoveries"]) },
  }),
  definition("fouls", ["player"], "Faltas cometidas", ["faltas cometidas", "faltas"], {
    providers: { BSD: playerStats(["fouls", "fouls_committed"]) },
  }),
  definition(
    "fouls_drawn",
    ["player"],
    "Faltas sofridas",
    ["faltas sofridas", "faltas recebidas"],
    { providers: { BSD: playerStats(["fouls_drawn", "was_fouled"]) } },
  ),
  definition("yellow_cards", ["player"], "Cartões amarelos", ["amarelos", "cartoes amarelos"], {
    providers: { BSD: playerStats(["yellow_cards"]) },
  }),
  definition(
    "red_cards",
    ["player"],
    "Cartões vermelhos",
    ["vermelhos", "cartoes vermelhos", "expulsoes"],
    { providers: { BSD: playerStats(["red_cards"]) } },
  ),
  definition("cards", ["player"], "Cartões", ["cartoes", "cartões"], {
    kind: "transitional",
    providers: { BSD: playerStats(["yellow_cards", "red_cards", "cards"]) },
  }),
  definition("xg", ["player"], "xG", ["xg", "gols esperados"], {
    providers: { BSD: playerStats(["xg", "expected_goals"]) },
  }),
  definition("xgot", ["player"], "xGOT", ["xgot", "expected goals on target"], {
    providers: { BSD: playerStats(["xgot"]) },
  }),
  definition("big_chances", ["player"], "Grandes chances", ["grandes chances"], {
    providers: { BSD: playerStats(["big_chances"]) },
  }),
  definition(
    "big_chances_scored",
    ["player"],
    "Grandes chances convertidas",
    ["grandes chances convertidas"],
    { providers: { BSD: playerStats(["big_chances_scored"]) } },
  ),
  definition(
    "big_chances_missed",
    ["player"],
    "Grandes chances perdidas",
    ["grandes chances perdidas"],
    { providers: { BSD: playerStats(["big_chances_missed"]) } },
  ),
  definition("saves", ["player"], "Defesas", ["defesas", "saves"], {
    providers: { BSD: playerStats(["saves", "goalkeeper_saves"]) },
  }),
  definition("big_saves", ["player"], "Grandes defesas", ["grandes defesas"], {
    providers: { BSD: playerStats(["big_saves"]) },
  }),
  definition("goals_prevented", ["player"], "Gols evitados", ["gols evitados"], {
    providers: { BSD: playerStats(["goals_prevented"]) },
  }),
];

export const FOOTBALL_METRIC_CATALOG = new Map<FootballMetric, FootballMetricDefinition>(
  [...TEAM_DEFINITIONS, ...PLAYER_DEFINITIONS].map((item) => [item.key, item]),
);

export function getFootballMetricDefinition(
  metric: FootballMetric,
  entityType?: MetricEntityType,
): FootballMetricDefinition | null {
  if (!entityType) return FOOTBALL_METRIC_CATALOG.get(metric) ?? null;
  const source = entityType === "team" ? TEAM_DEFINITIONS : PLAYER_DEFINITIONS;
  return source.find((item) => item.key === metric) ?? null;
}

export function metricIsSupportedForEntity(
  metric: FootballMetric,
  entityType: MetricEntityType,
): boolean {
  return getFootballMetricDefinition(metric, entityType) !== null;
}

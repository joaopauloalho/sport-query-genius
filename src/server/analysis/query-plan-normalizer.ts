type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function alias(value: unknown, aliases: Record<string, string>): unknown {
  if (typeof value !== "string") return value;
  const normalized = normalizeToken(value);
  return aliases[normalized] ?? normalized;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeToken(trimmed);
  if (["null", "none", "all", "todos", "todas", "qualquer"].includes(normalized)) return undefined;
  return trimmed;
}

function normalizeEntityType(value: unknown): unknown {
  return alias(value, {
    team: "team",
    time: "team",
    equipe: "team",
    club: "team",
    clube: "team",
    player: "player",
    jogador: "player",
    atleta: "player",
    competition: "competition",
    competicao: "competition",
    campeonato: "competition",
    liga: "competition",
    match: "match",
    jogo: "match",
    partida: "match",
    manager: "manager",
    coach: "manager",
    tecnico: "manager",
    treinador: "manager",
    referee: "referee",
    arbitro: "referee",
    venue: "venue",
    estadio: "venue",
    arena: "venue",
  });
}

function normalizeQueryKind(value: unknown): unknown {
  return alias(value, {
    aggregate: "aggregate",
    aggregation: "aggregate",
    agregado: "aggregate",
    event_list: "event_list",
    events: "event_list",
    lista_de_eventos: "event_list",
    match_list: "match_list",
    matches: "match_list",
    lista_de_jogos: "match_list",
    match_detail: "match_detail",
    detalhe_da_partida: "match_detail",
    comparison: "comparison",
    compare: "comparison",
    comparacao: "comparison",
    head_to_head: "head_to_head",
    h2h: "head_to_head",
    confrontos: "head_to_head",
    standings: "standings",
    tabela: "standings",
    classificacao: "standings",
    ranking: "ranking",
    profile: "profile",
    perfil: "profile",
    squad: "squad",
    elenco: "squad",
    availability: "availability",
    disponibilidade: "availability",
    desfalques: "availability",
    lineup: "lineup",
    escalacao: "lineup",
    transfer_list: "transfer_list",
    transfers: "transfer_list",
    transferencias: "transfer_list",
    schedule: "schedule",
    agenda: "schedule",
    live_status: "live_status",
    live: "live_status",
    ao_vivo: "live_status",
    odds: "odds",
    prediction: "prediction",
    previsao: "prediction",
  });
}

function normalizeAggregation(value: unknown): unknown {
  return alias(value, {
    average: "average",
    avg: "average",
    mean: "average",
    media: "average",
    total: "total",
    sum: "total",
    soma: "total",
    quantos: "total",
    median: "median",
    mediana: "median",
    minimum: "minimum",
    min: "minimum",
    minimo: "minimum",
    menor: "minimum",
    maximum: "maximum",
    max: "maximum",
    maximo: "maximum",
    maior: "maximum",
    count: "count",
    contagem: "count",
    quantidade: "count",
    percentage: "percentage",
    porcentagem: "percentage",
    percentual: "percentage",
    rate: "rate",
    taxa: "rate",
  });
}

function normalizeEventType(value: unknown): unknown {
  return alias(value, {
    goal: "goal",
    goals: "goal",
    gol: "goal",
    gols: "goal",
    assist: "assist",
    assists: "assist",
    assistencia: "assist",
    assistencias: "assist",
    yellow_card: "yellow_card",
    cartao_amarelo: "yellow_card",
    amarelo: "yellow_card",
    red_card: "red_card",
    cartao_vermelho: "red_card",
    vermelho: "red_card",
    expulsao: "red_card",
    substitution: "substitution",
    substituicao: "substitution",
    var: "var",
    penalty: "penalty",
    penalti: "penalty",
  });
}

function normalizeMetric(value: unknown, entityType: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = normalizeToken(value);
  const common: Record<string, string> = {
    shots: "shots",
    shot: "shots",
    total_shots: "shots",
    chutes: "shots",
    chute: "shots",
    finalizacoes: "shots",
    finalizacao: "shots",
    arremates: "shots",
    arremate: "shots",
    shots_on_target: "shots_on_target",
    shots_on_goal: "shots_on_target",
    chutes_no_gol: "shots_on_target",
    chutes_no_alvo: "shots_on_target",
    chutes_certos: "shots_on_target",
    finalizacoes_no_alvo: "shots_on_target",
    finalizacoes_certas: "shots_on_target",
    corners: "corners",
    corner: "corners",
    corner_kicks: "corners",
    escanteios: "corners",
    escanteio: "corners",
    cantos: "corners",
    tiros_de_canto: "corners",
    shots_off_target: "shots_off_target",
    chutes_para_fora: "shots_off_target",
    blocked_shots: "blocked_shots",
    chutes_bloqueados: "blocked_shots",
    shots_inside_box: "shots_inside_box",
    finalizacoes_dentro_da_area: "shots_inside_box",
    shots_outside_box: "shots_outside_box",
    finalizacoes_fora_da_area: "shots_outside_box",
    hit_woodwork: "hit_woodwork",
    bolas_na_trave: "hit_woodwork",
    big_chances: "big_chances",
    grandes_chances: "big_chances",
    big_chances_scored: "big_chances_scored",
    grandes_chances_convertidas: "big_chances_scored",
    big_chances_missed: "big_chances_missed",
    grandes_chances_perdidas: "big_chances_missed",
    touches_in_box: "touches_in_box",
    toques_na_area: "touches_in_box",
    final_third_entries: "final_third_entries",
    entradas_no_terco_final: "final_third_entries",
    offsides: "offsides",
    impedimentos: "offsides",
    passes: "passes",
    accurate_passes: "accurate_passes",
    passes_certos: "accurate_passes",
    passes_completos: "accurate_passes",
    pass_accuracy: "pass_accuracy",
    precisao_de_passe: "pass_accuracy",
    long_balls: "long_balls",
    bolas_longas: "long_balls",
    accurate_long_balls: "accurate_long_balls",
    bolas_longas_certas: "accurate_long_balls",
    crosses: "crosses",
    cruzamentos: "crosses",
    accurate_crosses: "accurate_crosses",
    cruzamentos_certos: "accurate_crosses",
    possession: "possession",
    posse: "possession",
    posse_de_bola: "possession",
    duels: "duels",
    duelos: "duels",
    duels_won: "duels_won",
    duelos_ganhos: "duels_won",
    ground_duels: "ground_duels",
    duelos_no_chao: "ground_duels",
    ground_duels_won: "ground_duels_won",
    duelos_no_chao_ganhos: "ground_duels_won",
    aerial_duels: "aerial_duels",
    duelos_aereos: "aerial_duels",
    aerial_duels_won: "aerial_duels_won",
    duelos_aereos_ganhos: "aerial_duels_won",
    dribbles: "dribbles",
    dribles: "dribbles",
    successful_dribbles: "successful_dribbles",
    dribles_certos: "successful_dribbles",
    dispossessed: "dispossessed",
    perdas_de_posse: "dispossessed",
    tackles: "tackles",
    desarmes: "tackles",
    tackles_won: "tackles_won",
    desarmes_certos: "tackles_won",
    interceptions: "interceptions",
    interceptacoes: "interceptions",
    clearances: "clearances",
    cortes: "clearances",
    recoveries: "recoveries",
    recuperacoes: "recoveries",
    fouls: "fouls",
    faltas: "fouls",
    fouls_drawn: "fouls_drawn",
    faltas_sofridas: "fouls_drawn",
    yellow_cards: "yellow_cards",
    amarelos: "yellow_cards",
    cartoes_amarelos: "yellow_cards",
    red_cards: "red_cards",
    vermelhos: "red_cards",
    cartoes_vermelhos: "red_cards",
    expulsoes: "red_cards",
    cards: "cards",
    cartoes: "cards",
    xg: "xg",
    expected_goals: "xg",
    gols_esperados: "xg",
    xgot: "xgot",
    saves: "saves",
    defesas: "saves",
    big_saves: "big_saves",
    grandes_defesas: "big_saves",
    goals_prevented: "goals_prevented",
    gols_evitados: "goals_prevented",
    clean_sheets: "clean_sheets",
    clean_sheet: "clean_sheets",
    jogos_sem_sofrer_gol: "clean_sheets",
    failed_to_score: "failed_to_score",
    passou_em_branco: "failed_to_score",
    both_teams_scored: "both_teams_scored",
    ambos_marcam: "both_teams_scored",
    assists: "assists",
    assistencias: "assists",
    minutes: "minutes",
    minutos: "minutes",
    rating: "rating",
    nota: "rating",
    key_passes: "key_passes",
    passes_decisivos: "key_passes",
    wins: "wins",
    vitorias: "wins",
    draws: "draws",
    empates: "draws",
    losses: "losses",
    derrotas: "losses",
    points: "points",
    pontos: "points",
    goal_difference: "goal_difference",
    saldo: "goal_difference",
    saldo_de_gols: "goal_difference",
    win_rate: "win_rate",
    aproveitamento: "win_rate",
    unbeaten_rate: "unbeaten_rate",
    invencibilidade: "unbeaten_rate",
    goals_against: "goals_against",
    goals_conceded: "goals_against",
    gols_sofridos: "goals_against",
  };

  if (["goals", "goal", "gols", "gol", "goals_scored", "gols_marcados"].includes(normalized)) {
    return entityType === "team" ? "goals_for" : "goals";
  }

  return common[normalized] ?? normalized;
}

function normalizeVenue(value: unknown): unknown {
  return alias(value, {
    all: "all",
    todos: "all",
    todas: "all",
    geral: "all",
    home: "home",
    casa: "home",
    mandante: "home",
    away: "away",
    fora: "away",
    visitante: "away",
  });
}

function normalizeHalf(value: unknown): unknown {
  return alias(value, {
    full: "full",
    jogo_todo: "full",
    partida_toda: "full",
    first: "first",
    primeiro: "first",
    primeiro_tempo: "first",
    second: "second",
    segundo: "second",
    segundo_tempo: "second",
  });
}

function normalizeStatus(value: unknown): unknown {
  return alias(value, {
    finished: "finished",
    finalizado: "finished",
    encerrado: "finished",
    live: "live",
    ao_vivo: "live",
    upcoming: "upcoming",
    proximo: "upcoming",
    futuro: "upcoming",
  });
}

function compact(record: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function normalizeEntity(raw: unknown, fallbackType?: unknown, fallbackName?: unknown): JsonRecord | undefined {
  const record = asRecord(raw);
  const type = normalizeEntityType(record?.type ?? fallbackType);
  const name = text(record?.name ?? fallbackName);
  if (!type || !name) return undefined;
  return compact({ type, name });
}

export function normalizeQueryPlanCandidate(raw: unknown): unknown {
  const record = asRecord(raw);
  if (!record) return raw;
  if (record.error === "question_not_understood") return { error: "question_not_understood" };
  if (record.error === "unsupported_metric") return record;

  const entity = normalizeEntity(record.entity, record.entity_type, record.entity_name);
  const entityType = entity?.type;
  const queryKind = normalizeQueryKind(record.query_kind);
  const compareRecord = asRecord(record.compare_with);
  const compareWith = normalizeEntity(
    record.compare_with,
    compareRecord?.type ?? compareRecord?.entity_type,
    compareRecord?.name ?? compareRecord?.entity_name,
  );

  const rawScope = asRecord(record.scope) ?? {};
  const scope = compact({
    last_matches: numeric(rawScope.last_matches ?? record.match_count),
    limit: numeric(rawScope.limit ?? record.event_count),
    date_from: text(rawScope.date_from ?? record.date_from),
    date_to: text(rawScope.date_to ?? record.date_to),
    season: text(rawScope.season ?? record.season),
    competition: text(rawScope.competition ?? record.competition),
    venue: normalizeVenue(rawScope.venue ?? record.venue ?? "all"),
    opponent: text(rawScope.opponent ?? record.opponent),
    half: normalizeHalf(rawScope.half ?? record.half ?? "full"),
    status: normalizeStatus(rawScope.status ?? record.status),
  });

  const eventType = normalizeEventType(record.event_type);
  const metric = queryKind === "event_list" ? undefined : normalizeMetric(record.metric, entityType);

  return compact({
    sport: alias(record.sport ?? "football", {
      football: "football",
      futebol: "football",
      soccer: "football",
    }),
    entity,
    query_kind: queryKind,
    metric,
    event_type: eventType,
    aggregation: normalizeAggregation(record.aggregation),
    scope,
    compare_with: compareWith,
  });
}

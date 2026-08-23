import { AnalysisPipelineError } from "./errors";
import type { QueryIntentInput } from "./intent-schema";
import {
  FOOTBALL_AGGREGATIONS,
  FOOTBALL_ENTITY_TYPES,
  FOOTBALL_EVENT_TYPES,
  FOOTBALL_QUERY_KINDS,
  queryPlanResponseSchema,
  type QueryPlan,
} from "./query-plan";
import { queryPlanToLegacyIntent } from "./query-plan-adapter";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `Você é exclusivamente um parser semântico para consultas de futebol.
Converta a pergunta do usuário para um QueryPlan JSON canônico. Nunca responda a pergunta esportiva,
nunca invente números, nunca estime estatísticas, nunca escolha IDs, nunca gere SQL/URLs e nunca use
conhecimento próprio para preencher resultado. Extraia linguagem e filtros; o backend resolve entidades,
capabilities, providers, cache e cálculos depois.

Contrato:
{
  "sport":"football",
  "entity":{"type":"team|player|competition|match|manager|referee|venue","name":"texto extraído"},
  "query_kind":"aggregate|event_list|match_list|match_detail|comparison|head_to_head|standings|ranking|profile|squad|availability|lineup|transfer_list|schedule|live_status|odds|prediction",
  "metric":"métrica canônica opcional",
  "event_type":"goal|assist|yellow_card|red_card|substitution|var|penalty opcional",
  "aggregation":"total|average|median|minimum|maximum|count|percentage|rate opcional",
  "scope":{
    "last_matches":5,
    "limit":5,
    "date_from":"YYYY-MM-DD",
    "date_to":"YYYY-MM-DD",
    "season":"texto",
    "competition":"texto",
    "venue":"home|away|all",
    "opponent":"texto",
    "half":"first|second|full",
    "status":"finished|live|upcoming"
  },
  "compare_with":{"type":"team|player|competition|match|manager|referee|venue","name":"texto"}
}

Regras estruturais:
- aggregate exige metric + aggregation.
- event_list exige event_type. Use scope.last_matches quando a pergunta diz eventos NAS últimas N partidas.
- "últimos N gols/cartões/eventos de um jogador" significa scope.limit=N, não last_matches=N.
- comparison e head_to_head exigem compare_with.
- head_to_head usa dois times.
- venue padrão all; half padrão full.
- Não defina resolved_id. O backend faz resolução conservadora.
- Não transforme ausência de período em um número arbitrário. Omita o campo quando não foi pedido.
- competition recebe somente competição explicitamente pedida.
- season recebe somente temporada explicitamente pedida; "temporada atual" pode ser a string "current".

Normalização de métricas de TIME:
- gols/gols marcados => goals_for
- gols sofridos/levou gols/tomou gols => goals_against
- saldo => goal_difference
- vitórias => wins; empates => draws; derrotas => losses; pontos => points
- aproveitamento/taxa de vitórias => win_rate; invencibilidade => unbeaten_rate
- clean sheet/jogos sem sofrer gol => clean_sheets
- não marcou/passou em branco => failed_to_score
- ambos marcam => both_teams_scored
- chutes/finalizações/arremates => shots
- chutes certos/finalizações no alvo => shots_on_target
- escanteios/cantos/tiros de canto => corners
- posse/posse de bola => possession
- passes certos/completos => accurate_passes
- desarmes => tackles
- amarelos => yellow_cards; vermelhos/expulsões => red_cards
- xG/gols esperados => xg
Use outras métricas canônicas quando o sentido for inequívoco.

Normalização de métricas de JOGADOR:
- gols => goals; assistências => assists; minutos => minutes
- chutes/finalizações => shots; no alvo => shots_on_target
- nota => rating; passes => passes; passes certos => accurate_passes; passes decisivos => key_passes
- duelos => duels; desarmes => tackles; interceptações => interceptions
- amarelos => yellow_cards; vermelhos => red_cards
- xG => xg; xGOT => xgot; defesas => saves

Agregações:
- média => average; soma/quantos no total => total; mediana => median
- maior/máximo => maximum; menor/mínimo => minimum
- quantidade de ocorrências => count; percentual/porcentagem => percentage; taxa => rate

Exemplos:
"Qual a média de escanteios do Corinthians nos últimos 5 jogos?"
=> {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"aggregate","metric":"corners","aggregation":"average","scope":{"last_matches":5,"venue":"all","half":"full"}}

"Quantos gols o Corinthians marcou nos últimos 5 jogos?"
=> {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"aggregate","metric":"goals_for","aggregation":"total","scope":{"last_matches":5,"venue":"all","half":"full"}}

"Quem fez gol do Corinthians nos últimos 5 jogos?"
=> {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"event_list","event_type":"goal","scope":{"last_matches":5,"venue":"all","half":"full"}}

"Quais foram os últimos 5 gols do Yuri Alberto?"
=> {"sport":"football","entity":{"type":"player","name":"Yuri Alberto"},"query_kind":"event_list","event_type":"goal","scope":{"limit":5,"venue":"all","half":"full"}}

"Quem fez mais gols nos últimos 10 jogos, Yuri Alberto ou Memphis?"
=> {"sport":"football","entity":{"type":"player","name":"Yuri Alberto"},"query_kind":"comparison","metric":"goals","aggregation":"total","scope":{"last_matches":10,"venue":"all","half":"full"},"compare_with":{"type":"player","name":"Memphis"}}

"Últimos 5 Corinthians x Palmeiras"
=> {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"head_to_head","scope":{"last_matches":5,"venue":"all","half":"full"},"compare_with":{"type":"team","name":"Palmeiras"}}

"Em que posição está o Corinthians no Brasileirão?"
=> {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"standings","scope":{"competition":"Brasileirão","venue":"all","half":"full"}}

"Quem está lesionado no Corinthians?"
=> {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"availability","scope":{"venue":"all","half":"full"}}

"Qual a provável escalação do Corinthians para o próximo jogo?"
=> {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"lineup","scope":{"status":"upcoming","venue":"all","half":"full"}}

Se a pergunta não puder ser convertida com segurança para esse contrato, devolva exatamente:
{"error":"question_not_understood"}

Retorne somente JSON válido.`;

const REPAIR_PROMPT = `Você corrige APENAS JSON de QueryPlan de futebol. Não responda estatísticas.
Retorne somente JSON válido, sem markdown. Preserve a semântica da pergunta original.

entity.type permitido: ${FOOTBALL_ENTITY_TYPES.join("|")}
query_kind permitido: ${FOOTBALL_QUERY_KINDS.join("|")}
event_type permitido: ${FOOTBALL_EVENT_TYPES.join("|")}
aggregation permitido: ${FOOTBALL_AGGREGATIONS.join("|")}

aggregate exige metric e aggregation; event_list exige event_type; comparison/head_to_head exigem compare_with.
Use nomes canônicos de métricas. Nunca invente resolved_id, dados esportivos ou filtros não pedidos.
Se não der para corrigir com segurança, retorne {"error":"question_not_understood"}.`;

type DeepSeekResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
};

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
    passes: "passes",
    accurate_passes: "accurate_passes",
    passes_certos: "accurate_passes",
    passes_completos: "accurate_passes",
    pass_accuracy: "pass_accuracy",
    precisao_de_passe: "pass_accuracy",
    possession: "possession",
    posse: "possession",
    posse_de_bola: "possession",
    tackles: "tackles",
    desarmes: "tackles",
    interceptions: "interceptions",
    interceptacoes: "interceptions",
    fouls: "fouls",
    faltas: "fouls",
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
    clean_sheets: "clean_sheets",
    clean_sheet: "clean_sheets",
    jogos_sem_sofrer_gol: "clean_sheets",
    assists: "assists",
    assistencias: "assists",
    minutes: "minutes",
    minutos: "minutes",
    rating: "rating",
    nota: "rating",
    key_passes: "key_passes",
    passes_decisivos: "key_passes",
    xgot: "xgot",
    saves: "saves",
    defesas: "saves",
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
    failed_to_score: "failed_to_score",
    both_teams_scored: "both_teams_scored",
    ambos_marcam: "both_teams_scored",
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

function compact<T extends JsonRecord>(record: T): JsonRecord {
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
  const compareWith = normalizeEntity(
    record.compare_with,
    asRecord(record.compare_with)?.entity_type,
    asRecord(record.compare_with)?.entity_name,
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

function validationSummary(error: { issues: Array<{ path: Array<string | number>; code: string }> }) {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
  }));
}

async function requestJsonPlan(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 900,
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
  } catch {
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "O DeepSeek não respondeu à solicitação de interpretação.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      `O DeepSeek retornou uma falha de serviço (HTTP ${response.status}).`,
    );
  }

  let payload: DeepSeekResponse;
  try {
    payload = (await response.json()) as DeepSeekResponse;
  } catch {
    throw new AnalysisPipelineError(
      "INVALID_DEEPSEEK_OUTPUT",
      "O DeepSeek retornou uma resposta que não pôde ser validada.",
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content || payload.choices?.[0]?.finish_reason === "length") {
    throw new AnalysisPipelineError(
      "INVALID_DEEPSEEK_OUTPUT",
      "O DeepSeek retornou um QueryPlan vazio ou incompleto.",
    );
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new AnalysisPipelineError("INVALID_DEEPSEEK_OUTPUT", "O DeepSeek retornou JSON inválido.");
  }
}

function resolveParsedPlan(
  parsed: ReturnType<typeof queryPlanResponseSchema.safeParse>,
  raw: unknown,
): QueryPlan {
  const rawRecord = asRecord(raw);
  if (rawRecord?.error === "unsupported_metric") {
    const metric = typeof rawRecord.metric === "string" ? rawRecord.metric.trim() : "métrica não informada";
    throw new AnalysisPipelineError(
      "UNSUPPORTED_METRIC",
      `A métrica "${metric}" não pôde ser normalizada para o catálogo canônico.`,
    );
  }

  if (!parsed.success) {
    throw new AnalysisPipelineError(
      "INVALID_DEEPSEEK_OUTPUT",
      "O QueryPlan produzido pelo DeepSeek não passou pela validação de segurança.",
    );
  }
  if ("error" in parsed.data) {
    throw new AnalysisPipelineError(
      "QUESTION_NOT_UNDERSTOOD",
      "Não conseguimos compreender a pergunta com segurança suficiente para consultar dados reais.",
    );
  }
  return parsed.data;
}

export async function parseQueryPlanWithDeepSeek(question: string): Promise<QueryPlan> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "A integração com o DeepSeek não está configurada no servidor.",
    );
  }

  const raw = await requestJsonPlan(SYSTEM_PROMPT, question, apiKey);
  const normalized = normalizeQueryPlanCandidate(raw);
  const firstPass = queryPlanResponseSchema.safeParse(normalized);
  if (firstPass.success) return resolveParsedPlan(firstPass, normalized);

  console.warn("[deepseek-query-plan] first-pass validation failed", {
    issues: validationSummary(firstPass.error),
    keys: asRecord(raw) ? Object.keys(asRecord(raw)!).slice(0, 16) : [],
  });

  const repairedRaw = await requestJsonPlan(
    REPAIR_PROMPT,
    `Pergunta original: ${question}\nJSON a corrigir: ${JSON.stringify(raw)}\nErros de validação: ${JSON.stringify(validationSummary(firstPass.error))}`,
    apiKey,
  );
  const repaired = normalizeQueryPlanCandidate(repairedRaw);
  const secondPass = queryPlanResponseSchema.safeParse(repaired);

  if (!secondPass.success) {
    console.warn("[deepseek-query-plan] repair validation failed", {
      issues: validationSummary(secondPass.error),
      keys: asRecord(repairedRaw) ? Object.keys(asRecord(repairedRaw)!).slice(0, 16) : [],
    });
  }

  return resolveParsedPlan(secondPass, repaired);
}

/** Compatibility bridge while Phase 4 capabilities migrate to QueryPlan executors. */
export async function parseIntentWithDeepSeek(question: string): Promise<QueryIntentInput> {
  return queryPlanToLegacyIntent(await parseQueryPlanWithDeepSeek(question));
}

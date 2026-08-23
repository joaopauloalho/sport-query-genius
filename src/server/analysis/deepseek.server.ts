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
import { normalizeQueryPlanCandidate } from "./query-plan-normalizer";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `Você é exclusivamente um parser semântico para consultas de futebol.
Converta a pergunta para um QueryPlan JSON canônico. Nunca responda a pergunta esportiva, nunca invente
números, nunca estime estatísticas, nunca escolha IDs, nunca gere SQL/URLs e nunca use conhecimento próprio
para preencher resultado. O backend resolve entidades, capabilities, providers, cache e cálculos depois.

Contrato:
{
  "sport":"football",
  "entity":{"type":"team|player|competition|match|manager|referee|venue","name":"texto extraído"},
  "query_kind":"aggregate|event_list|match_list|match_detail|comparison|head_to_head|standings|ranking|profile|squad|availability|lineup|transfer_list|schedule|live_status|odds|prediction",
  "metric":"métrica canônica opcional",
  "event_type":"goal|assist|yellow_card|red_card|substitution|var|penalty opcional",
  "aggregation":"total|average|median|minimum|maximum|count|percentage|rate opcional",
  "scope":{"last_matches":5,"limit":5,"date_from":"YYYY-MM-DD","date_to":"YYYY-MM-DD","season":"texto","competition":"texto","venue":"home|away|all","opponent":"texto","half":"first|second|full","status":"finished|live|upcoming"},
  "compare_with":{"type":"team|player|competition|match|manager|referee|venue","name":"texto"}
}

Regras:
- aggregate exige metric + aggregation; event_list exige event_type.
- comparison e head_to_head exigem compare_with; head_to_head usa dois times.
- Em event_list, "eventos nos últimos N jogos" => scope.last_matches=N; "últimos N gols/eventos" => scope.limit=N.
- venue padrão all e half padrão full. Não defina resolved_id.
- Não invente período, competição ou temporada. "temporada atual" pode ser season="current".
- Nomes devem permanecer como escritos pelo usuário; o backend resolve aliases/IDs conservadoramente.

Métricas canônicas de time:
goals_for, goals_against, goal_difference, wins, draws, losses, points, win_rate, unbeaten_rate,
clean_sheets, failed_to_score, both_teams_scored, shots, shots_on_target, shots_off_target,
blocked_shots, shots_inside_box, shots_outside_box, hit_woodwork, big_chances, big_chances_scored,
big_chances_missed, xg, touches_in_box, final_third_entries, offsides, corners, passes,
accurate_passes, pass_accuracy, long_balls, accurate_long_balls, crosses, accurate_crosses,
possession, duels, duels_won, ground_duels, ground_duels_won, aerial_duels, aerial_duels_won,
dribbles, successful_dribbles, dispossessed, tackles, tackles_won, interceptions, clearances,
recoveries, fouls, yellow_cards, red_cards, cards, saves, big_saves, goals_prevented.

Métricas canônicas de jogador incluem:
minutes, goals, assists, shots, shots_on_target, shots_off_target, blocked_shots, rating, passes,
accurate_passes, pass_accuracy, key_passes, crosses, accurate_crosses, long_balls,
accurate_long_balls, duels, duels_won, ground_duels, ground_duels_won, aerial_duels,
aerial_duels_won, dribbles, successful_dribbles, dispossessed, tackles, tackles_won,
interceptions, clearances, recoveries, fouls, fouls_drawn, yellow_cards, red_cards, cards,
xg, xgot, big_chances, big_chances_scored, big_chances_missed, saves, big_saves, goals_prevented.

Normalize semanticamente, não por frase fechada:
- chutes/finalizações/arremates => shots; chutes certos/finalizações no alvo => shots_on_target
- escanteios/cantos/tiros de canto => corners
- cartões amarelos/amarelos => yellow_cards; vermelhos/expulsões => red_cards
- desarmes => tackles; posse de bola => possession; passes certos/completos => accurate_passes
- time: gols marcados => goals_for; gols sofridos/levou/tomou gols => goals_against
- time: jogos sem sofrer gol/clean sheet => clean_sheets
- jogador: gols => goals; assistências => assists; minutos => minutes; nota => rating
- média => average; soma/total => total; mediana => median; maior => maximum; menor => minimum;
  quantidade => count; porcentagem => percentage; taxa => rate.

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

Se não puder converter com segurança, devolva exatamente {"error":"question_not_understood"}.
Retorne somente JSON válido.`;

const REPAIR_PROMPT = `Você corrige somente JSON de QueryPlan de futebol; não responda estatísticas.
Retorne somente JSON válido, sem markdown, preservando a semântica original.
entity.type: ${FOOTBALL_ENTITY_TYPES.join("|")}
query_kind: ${FOOTBALL_QUERY_KINDS.join("|")}
event_type: ${FOOTBALL_EVENT_TYPES.join("|")}
aggregation: ${FOOTBALL_AGGREGATIONS.join("|")}
aggregate exige metric+aggregation; event_list exige event_type; comparison/head_to_head exigem compare_with.
Nunca invente resolved_id, números esportivos ou filtros não pedidos. Se não der para corrigir com segurança,
retorne {"error":"question_not_understood"}.`;

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

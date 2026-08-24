import { AnalysisPipelineError } from "./errors";
import {
  FOOTBALL_AGGREGATIONS,
  FOOTBALL_ENTITY_TYPES,
  FOOTBALL_EVENT_TYPES,
  FOOTBALL_FILTER_FIELDS,
  FOOTBALL_FILTER_OPERATORS,
  FOOTBALL_GROUP_BY_FIELDS,
  FOOTBALL_QUERY_KINDS,
  queryPlanResponseSchema,
  type QueryPlan,
} from "./query-plan";
import { normalizeUniversalQueryPlanCandidate } from "./query-plan-v4c-normalizer";
import { FOOTBALL_METRIC_KEYS } from "../sports/metric-catalog";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `Você é exclusivamente um parser semântico para consultas de futebol.
Converta a pergunta em UM QueryPlan JSON estruturado. Nunca responda a estatística, nunca invente números,
IDs, SQL, URLs ou dados esportivos. O backend TypeScript resolve entidades, providers, cache, filtros e cálculos.

Contrato canônico:
{
  "sport":"football",
  "entity":{"type":"team|player|competition|match|manager|referee|venue","name":"texto do usuário"},
  "query_kind":"${FOOTBALL_QUERY_KINDS.join("|")}",
  "metric":"métrica canônica opcional",
  "event_type":"${FOOTBALL_EVENT_TYPES.join("|")} opcional",
  "aggregation":"${FOOTBALL_AGGREGATIONS.join("|")} opcional",
  "scope":{
    "last_matches":30,
    "date_from":"YYYY-MM-DD",
    "date_to":"YYYY-MM-DD",
    "season":"2026|2025/26|current|previous",
    "competition":"texto",
    "venue":"home|away|all",
    "opponent":"texto",
    "half":"first|second|full",
    "status":"finished|live|upcoming",
    "limit":5
  },
  "filters":[{"field":"${FOOTBALL_FILTER_FIELDS.join("|")}","operator":"${FOOTBALL_FILTER_OPERATORS.join("|")}","value":"escalar ou array"}],
  "group_by":["${FOOTBALL_GROUP_BY_FIELDS.join('","')}"],
  "sort":{"field":"value|sample_size|group","direction":"asc|desc"},
  "limit":10,
  "compare_with":{"type":"team|player|competition|match|manager|referee|venue","name":"texto"}
}

Regras críticas:
- aggregate exige metric + aggregation.
- event_list exige event_type.
- comparison/head_to_head exigem compare_with; head_to_head usa dois times.
- NÃO invente last_matches. Só defina last_matches quando a pergunta pedir explicitamente últimos N jogos/partidas.
- competição, temporada ou intervalo de datas definem o conjunto inteiro. Ex.: "Brasileirão 2026" NÃO recebe last_matches.
- scope.limit é compatibilidade para quantidade de EVENTOS em event_list ("últimos 5 gols").
- top-level limit limita LINHAS DE SAÍDA depois de group/sort; nunca limita a amostra usada no cálculo.
- venue padrão all e half padrão full. Não defina resolved_id.
- "temporada atual" pode ser season="current"; "temporada passada" pode ser season="previous".
- nomes de entidades permanecem como escritos pelo usuário; o backend faz resolução conservadora.
- filtros são dados estruturados, nunca expressões livres.
- "jogos que venceu" => filters outcome eq win.
- "sofreu pelo menos 2 gols" => filters goals_against gte 2.
- "ambos marcaram" como condição => filters both_teams_scored eq true.
- "compare casa e fora" para o MESMO time => aggregate + group_by ["venue"], sem compare_with.
- "por competição" => group_by ["competition"].
- "contra quais adversários ... mais" => group_by ["opponent"], sort value desc e limit se pedido.
- match_list + filters serve para "mostre os jogos em que...".
- "quantos jogos fez" => metric goals_for + aggregation count (count conta partidas com placar válido).
- "quantos jogos venceu" => metric wins + aggregation count.
- "quantos jogos perdeu" => metric losses + aggregation count.
- "quantos jogos sem sofrer gol" => metric clean_sheets + aggregation count.
- "quantos jogos sem marcar" => metric failed_to_score + aggregation count.
- "quantos jogos ambos marcaram" => metric both_teams_scored + aggregation count.
- "percentual de jogos com ambos marcando" => metric both_teams_scored + aggregation percentage.
- "taxa de vitórias" => metric win_rate + aggregation percentage.
- "aproveitamento" => metric points + aggregation percentage (pontos conquistados / pontos possíveis).
- time: "gols", "gols marcados" => goals_for; "gols sofridos/tomados/levados" => goals_against.
- jogador: "gols" => goals.
- média=>average; total/soma=>total; mediana=>median; máximo/maior=>maximum; mínimo/menor=>minimum.

Métricas canônicas disponíveis no catálogo:
${FOOTBALL_METRIC_KEYS.join(", ")}.

Exemplos:
Pergunta: "No Brasileirão 2026, qual foi a média de gols sofridos do Corinthians em casa?"
JSON: {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"aggregate","metric":"goals_against","aggregation":"average","scope":{"season":"2026","competition":"Brasileirão","venue":"home","half":"full","status":"finished"},"filters":[],"group_by":[]}

Pergunta: "Qual foi a média de escanteios do Corinthians nos jogos que venceu no Brasileirão 2026?"
JSON: {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"aggregate","metric":"corners","aggregation":"average","scope":{"season":"2026","competition":"Brasileirão","venue":"all","half":"full","status":"finished"},"filters":[{"field":"outcome","operator":"eq","value":"win"}],"group_by":[]}

Pergunta: "Em quantos jogos o Corinthians sofreu 2 ou mais gols no Brasileirão 2026?"
JSON: {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"aggregate","metric":"goals_for","aggregation":"count","scope":{"season":"2026","competition":"Brasileirão","venue":"all","half":"full","status":"finished"},"filters":[{"field":"goals_against","operator":"gte","value":2}],"group_by":[]}

Pergunta: "Mostre os jogos do Corinthians em que sofreu 2 ou mais gols no Brasileirão 2026."
JSON: {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"match_list","scope":{"season":"2026","competition":"Brasileirão","venue":"all","half":"full","status":"finished"},"filters":[{"field":"goals_against","operator":"gte","value":2}],"group_by":[]}

Pergunta: "Compare a média de gols sofridos do Corinthians em casa e fora no Brasileirão 2026."
JSON: {"sport":"football","entity":{"type":"team","name":"Corinthians"},"query_kind":"aggregate","metric":"goals_against","aggregation":"average","scope":{"season":"2026","competition":"Brasileirão","venue":"all","half":"full","status":"finished"},"filters":[],"group_by":["venue"]}

Pergunta: "Quais foram os últimos 5 gols do Yuri Alberto?"
JSON: {"sport":"football","entity":{"type":"player","name":"Yuri Alberto"},"query_kind":"event_list","event_type":"goal","scope":{"limit":5,"venue":"all","half":"full"},"filters":[],"group_by":[]}

Se a pergunta não puder ser convertida com segurança, retorne exatamente {"error":"question_not_understood"}.
Retorne somente JSON válido.`;

const REPAIR_PROMPT = `Corrija somente JSON de QueryPlan de futebol; não responda estatísticas.
entity.type: ${FOOTBALL_ENTITY_TYPES.join("|")}
query_kind: ${FOOTBALL_QUERY_KINDS.join("|")}
event_type: ${FOOTBALL_EVENT_TYPES.join("|")}
aggregation: ${FOOTBALL_AGGREGATIONS.join("|")}
filter.field: ${FOOTBALL_FILTER_FIELDS.join("|")}
filter.operator: ${FOOTBALL_FILTER_OPERATORS.join("|")}
group_by: ${FOOTBALL_GROUP_BY_FIELDS.join("|")}
aggregate exige metric+aggregation; event_list exige event_type; comparison/head_to_head exigem compare_with.
Não invente last_matches, IDs, números esportivos ou filtros não pedidos.
Retorne somente JSON válido ou {"error":"question_not_understood"}.`;

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

function validationSummary(error: {
  issues: Array<{ path: Array<string | number>; code: string }>;
}) {
  return error.issues.slice(0, 12).map((issue) => ({
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
  try {
    const response = await fetch(DEEPSEEK_URL, {
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
        max_tokens: 1400,
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });

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

    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (!content || choice?.finish_reason === "length") {
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
  } catch (error) {
    if (error instanceof AnalysisPipelineError) throw error;
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "O DeepSeek não respondeu à solicitação de interpretação.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function resolveParsedPlan(
  parsed: ReturnType<typeof queryPlanResponseSchema.safeParse>,
  raw: unknown,
): QueryPlan {
  const rawRecord = asRecord(raw);
  if (rawRecord?.error === "unsupported_metric") {
    const metric =
      typeof rawRecord.metric === "string" ? rawRecord.metric.trim() : "métrica não informada";
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

export async function parseUniversalQueryPlanWithDeepSeek(question: string): Promise<QueryPlan> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "A integração com o DeepSeek não está configurada no servidor.",
    );
  }

  const raw = await requestJsonPlan(SYSTEM_PROMPT, question, apiKey);
  const normalized = normalizeUniversalQueryPlanCandidate(raw);
  const firstPass = queryPlanResponseSchema.safeParse(normalized);
  if (firstPass.success) return resolveParsedPlan(firstPass, normalized);

  console.warn("[deepseek-query-plan-v4c] first-pass validation failed", {
    issues: validationSummary(firstPass.error),
    keys: asRecord(raw) ? Object.keys(asRecord(raw)!).slice(0, 20) : [],
  });

  const repairedRaw = await requestJsonPlan(
    REPAIR_PROMPT,
    `Pergunta original: ${question}\nJSON a corrigir: ${JSON.stringify(raw)}\nErros: ${JSON.stringify(validationSummary(firstPass.error))}`,
    apiKey,
  );
  const repaired = normalizeUniversalQueryPlanCandidate(repairedRaw);
  const secondPass = queryPlanResponseSchema.safeParse(repaired);
  if (!secondPass.success) {
    console.warn("[deepseek-query-plan-v4c] repair validation failed", {
      issues: validationSummary(secondPass.error),
    });
  }
  return resolveParsedPlan(secondPass, repaired);
}

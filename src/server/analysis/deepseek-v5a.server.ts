import { AnalysisPipelineError } from "./errors";
import {
  FOOTBALL_AGGREGATIONS,
  FOOTBALL_ENTITY_TYPES,
  FOOTBALL_EVENT_TYPES,
  FOOTBALL_FILTER_OPERATORS,
  FOOTBALL_GROUP_BY_FIELDS,
  FOOTBALL_QUERY_KINDS,
} from "./query-plan";
import { createSemanticPlan, semanticPlanResponseSchema, type SemanticPlan } from "./semantic-plan";
import { normalizeTruthfulSemanticCandidate } from "./query-plan-v5a-normalizer";
import { FOOTBALL_METRIC_KEYS } from "../sports/metric-catalog";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `Você é exclusivamente um parser semântico para consultas de futebol.
Converta a pergunta em UM SemanticPlan JSON. Nunca responda a estatística, nunca invente números, IDs,
SQL, URLs ou dados esportivos. Preserve toda condição relevante mesmo quando ela talvez ainda não seja
executável; o backend negociará capabilities e recusará explicitamente o que não puder executar.

Contrato:
{
  "sport":"football",
  "entity":{"type":"${FOOTBALL_ENTITY_TYPES.join("|")}","name":"texto do usuário"},
  "query_kind":"${FOOTBALL_QUERY_KINDS.join("|")}",
  "metric":"métrica canônica opcional",
  "event_type":"${FOOTBALL_EVENT_TYPES.join("|")} opcional",
  "aggregation":"${FOOTBALL_AGGREGATIONS.join("|")} opcional",
  "scope":{"last_matches":30,"date_from":"YYYY-MM-DD","date_to":"YYYY-MM-DD","season":"2026|2025/26|current|previous","competition":"texto","venue":"home|away|all","opponent":"texto","half":"first|second|full","status":"finished|live|upcoming","limit":5},
  "filters":[{"field":"campo semântico canônico; pode ser métrica como possession","operator":"${FOOTBALL_FILTER_OPERATORS.join("|")}","value":"escalar ou array"}],
  "group_by":["${FOOTBALL_GROUP_BY_FIELDS.join('","')} ou dimensão pedida explicitamente"],
  "sort":{"field":"value|sample_size|group ou campo explicitamente pedido","direction":"asc|desc"},
  "limit":10,
  "compare_with":{"type":"team|player|competition|match|manager|referee|venue","name":"texto"}
}

Regras críticas:
- ZERO perda semântica: nunca remova filtro, group_by, sort, limite, temporada, competição, adversário, compare_with ou event_type só porque parece não suportado.
- Ex.: "mais de 60% de posse" => filters [{"field":"possession","operator":"gt","value":60}].
- aggregate exige metric + aggregation; event_list exige event_type; comparison/head_to_head exigem compare_with.
- NÃO invente last_matches; só use quando o usuário pedir últimos N jogos.
- competição/temporada/data definem o escopo solicitado; não invente datas para uma temporada.
- scope.limit é quantidade de eventos em event_list. top-level limit é quantidade de linhas após group/sort.
- venue padrão all e half padrão full. Não defina resolved_id.
- "jogos que venceu" => filters outcome eq win.
- "compare casa e fora" do mesmo time => aggregate + group_by ["venue"].
- "5 adversários ... maior" => group_by ["opponent"], sort value desc, limit 5.
- match_list + filters representa "mostre os jogos em que...".
- "aproveitamento" => metric points + aggregation percentage.
- time: gols => goals_for; gols sofridos => goals_against. jogador: gols => goals.
- média=>average; total=>total; mediana=>median; máximo=>maximum; mínimo=>minimum.

Métricas canônicas conhecidas:
${FOOTBALL_METRIC_KEYS.join(", ")}.

Se não conseguir identificar com segurança a estrutura central da pergunta, retorne exatamente {"error":"question_not_understood"}.
Retorne somente JSON válido.`;

type DeepSeekResponse = {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
};

async function requestJson(question: string, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 1600,
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
    const payload = (await response.json()) as DeepSeekResponse;
    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (!content || choice?.finish_reason === "length") {
      throw new AnalysisPipelineError(
        "INVALID_DEEPSEEK_OUTPUT",
        "O DeepSeek retornou um SemanticPlan vazio ou incompleto.",
      );
    }
    try {
      return JSON.parse(content) as unknown;
    } catch {
      throw new AnalysisPipelineError(
        "INVALID_DEEPSEEK_OUTPUT",
        "O DeepSeek retornou JSON inválido.",
      );
    }
  } catch (error) {
    if (error instanceof AnalysisPipelineError) throw error;
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "O DeepSeek não respondeu à interpretação semântica.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Phase 5A deliberately has no semantic-repair pass: malformed output fails closed instead of being silently simplified. */
export async function parseUniversalSemanticPlanWithDeepSeek(
  question: string,
): Promise<SemanticPlan> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey)
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "A integração com o DeepSeek não está configurada no servidor.",
    );

  const raw = await requestJson(question, apiKey);
  const normalized = normalizeTruthfulSemanticCandidate(raw);
  const parsed = semanticPlanResponseSchema.safeParse(normalized);
  if (!parsed.success) {
    console.warn("[deepseek-semantic-plan-v5a] validation failed", {
      issues: parsed.error.issues
        .slice(0, 12)
        .map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
    throw new AnalysisPipelineError(
      "INVALID_DEEPSEEK_OUTPUT",
      "O SemanticPlan não passou pela validação. A consulta não será simplificada automaticamente.",
    );
  }
  if ("error" in parsed.data) {
    throw new AnalysisPipelineError(
      "QUESTION_NOT_UNDERSTOOD",
      "Não conseguimos compreender a pergunta com segurança suficiente para consultar dados reais.",
    );
  }

  const semantic = createSemanticPlan(parsed.data, raw);
  if (semantic.preservation_issues.length > 0) {
    const first = semantic.preservation_issues[0];
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      `O parser produziu o campo semântico "${first.field}" em ${first.path}. Ele foi detectado e não será descartado silenciosamente.`,
    );
  }
  return semantic;
}

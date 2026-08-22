import {
  PLAYER_METRICS,
  SUPPORTED_METRICS,
  deepSeekIntentResponseSchema,
  type QueryIntentInput,
} from "./intent-schema";
import { AnalysisPipelineError } from "./errors";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `Você é um parser de intenção para uma plataforma de estatísticas esportivas.
Sua única função é converter a pergunta do usuário em JSON. Nunca responda estatísticas, nunca estime números,
nunca consulte dados, nunca gere SQL/URLs e nunca use conhecimento próprio para preencher resultados esportivos.

Existem três formatos aceitos.

1) Agregação de TIME:
{
  "sport":"football","query_kind":"aggregate","entity_type":"team","entity_name":"Corinthians",
  "metric":"corners","aggregation":"average","match_count":5,"competition":null,"venue":"all"
}

2) Agregação de JOGADOR:
{
  "sport":"football","query_kind":"aggregate","entity_type":"player","entity_name":"Yuri Alberto",
  "metric":"shots","aggregation":"average","match_count":5,"competition":null,"venue":"all"
}

3) Lista de EVENTOS de gol de jogador:
{
  "sport":"football","query_kind":"event_list","entity_type":"player","entity_name":"Yuri Alberto",
  "metric":"goals","event_type":"goal","event_count":5,"competition":null,"venue":"all"
}

Regras semânticas obrigatórias:
- "média de escanteios do Bayern de Munique nos últimos 5 jogos" => team + aggregate + corners + average + 5.
- "média de finalizações do Yuri Alberto nos últimos 5 jogos" => player + aggregate + shots + average + 5.
- "Yuri Alberto fez quantos gols nos últimos 10 jogos?" => player + aggregate + goals + total + 10.
- "quantos chutes no gol o Yuri teve nas últimas 5 partidas?" => player + aggregate + shots_on_target + total + 5.
- "quais foram os últimos 5 gols do Yuri Alberto?" => player + event_list + goal + event_count=5.
- "me mostra os últimos cinco gols do Yuri Alberto" => exatamente a mesma intenção event_list; NÃO significa gols nos últimos cinco jogos.

Restrições:
- sport: somente "football".
- query_kind: "aggregate" ou "event_list".
- entity_type: "team" ou "player".
- métricas de time: corners, goals, shots, shots_on_target, cards.
- métricas de jogador no MVP: goals, shots, shots_on_target, cards.
- aggregation em aggregate: average, total ou median.
- match_count em aggregate: exatamente 5, 10, 15 ou 20.
- event_list: somente jogador + goals + event_type="goal" + event_count de 1 a 20.
- venue: time pode ser all/home/away; jogador deve ser all.
- competition: texto explícito da pergunta ou null.
- Não desambigue nomes usando conhecimento próprio: extraia o nome pedido e deixe o backend resolver a entidade.

Se a pergunta não puder ser compreendida com segurança, devolva exatamente:
{"error":"question_not_understood"}

Se a pergunta pedir uma métrica esportiva fora do contrato daquela entidade, devolva:
{"error":"unsupported_metric","metric":"nome pedido"}

A resposta deve conter apenas JSON válido.`;

const REPAIR_PROMPT = `Você corrige JSON de intenção de futebol. Retorne somente JSON válido, sem comentários e sem markdown.
Nunca responda ou estime a estatística esportiva.

Contratos:
TEAM aggregate: sport=football, query_kind=aggregate, entity_type=team, entity_name string,
metric=corners|goals|shots|shots_on_target|cards, aggregation=average|total|median,
match_count=5|10|15|20, competition string|null, venue=all|home|away.

PLAYER aggregate: sport=football, query_kind=aggregate, entity_type=player, entity_name string,
metric=goals|shots|shots_on_target|cards, aggregation=average|total|median,
match_count=5|10|15|20, competition string|null, venue=all.

PLAYER event_list: sport=football, query_kind=event_list, entity_type=player, entity_name string,
metric=goals, event_type=goal, event_count=1..20, competition string|null, venue=all.
"últimos N gols" é event_list; NÃO converta para "gols nos últimos N jogos".

Se a métrica não estiver no contrato da entidade, retorne {"error":"unsupported_metric","metric":"nome pedido"}.
Se não for possível corrigir com segurança, retorne {"error":"question_not_understood"}.`;

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
    .replace(/[\s-]+/g, "_");
}

function normalizeAlias(value: unknown, aliases: Record<string, string>): unknown {
  if (typeof value !== "string") return value;
  const normalized = normalizeToken(value);
  return aliases[normalized] ?? value.trim();
}

function numericValue(value: unknown): unknown {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return value;
}

function normalizeCompetition(value: unknown): string | null | unknown {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  const normalized = normalizeToken(trimmed);
  return ["", "all", "todas", "todos", "qualquer", "none", "null"].includes(normalized)
    ? null
    : trimmed;
}

function normalizeIntentCandidate(raw: unknown): unknown {
  const record = asRecord(raw);
  if (!record) return raw;

  if (typeof record.error === "string") {
    if (record.error === "unsupported_metric") {
      return {
        error: "unsupported_metric",
        metric: typeof record.metric === "string" ? record.metric.trim() : "métrica não informada",
      };
    }
    if (record.error === "question_not_understood") return { error: "question_not_understood" };
  }

  const sport = normalizeAlias(record.sport, {
    football: "football",
    futebol: "football",
    soccer: "football",
  });
  const entityType = normalizeAlias(record.entity_type, {
    team: "team",
    time: "team",
    equipe: "team",
    club: "team",
    clube: "team",
    player: "player",
    jogador: "player",
    atleta: "player",
  });
  const queryKind = normalizeAlias(record.query_kind, {
    aggregate: "aggregate",
    aggregation: "aggregate",
    agregado: "aggregate",
    event_list: "event_list",
    events: "event_list",
    lista_de_eventos: "event_list",
  });
  const metric = normalizeAlias(record.metric, {
    corners: "corners",
    corner: "corners",
    corner_kicks: "corners",
    escanteio: "corners",
    escanteios: "corners",
    goals: "goals",
    goal: "goals",
    goals_scored: "goals",
    gols: "goals",
    gol: "goals",
    shots: "shots",
    total_shots: "shots",
    finalizacoes: "shots",
    finalizacao: "shots",
    chutes: "shots",
    shots_on_target: "shots_on_target",
    shots_on_goal: "shots_on_target",
    finalizacoes_no_alvo: "shots_on_target",
    finalizacao_no_alvo: "shots_on_target",
    chutes_no_gol: "shots_on_target",
    chutes_no_alvo: "shots_on_target",
    cards: "cards",
    card: "cards",
    cartoes: "cards",
    cartao: "cards",
  });
  const aggregation = normalizeAlias(record.aggregation, {
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
  });
  const venue = normalizeAlias(record.venue, {
    all: "all",
    todos: "all",
    todas: "all",
    geral: "all",
    home: "home",
    casa: "home",
    away: "away",
    fora: "away",
  });
  const eventType = normalizeAlias(record.event_type, {
    goal: "goal",
    goals: "goal",
    gol: "goal",
    gols: "goal",
  });

  const inferredKind =
    queryKind ?? (record.event_count !== undefined || eventType === "goal" ? "event_list" : "aggregate");
  const competition = normalizeCompetition(record.competition);
  const entityName =
    typeof record.entity_name === "string" ? record.entity_name.trim() : record.entity_name;

  if (inferredKind === "event_list") {
    return {
      sport,
      query_kind: "event_list",
      entity_type: entityType,
      entity_name: entityName,
      metric,
      event_type: eventType,
      event_count: numericValue(record.event_count),
      competition: competition ?? null,
      venue: entityType === "player" ? "all" : venue,
    };
  }

  return {
    sport,
    query_kind: "aggregate",
    entity_type: entityType,
    entity_name: entityName,
    metric,
    aggregation,
    match_count: numericValue(record.match_count),
    competition: competition ?? null,
    venue: entityType === "player" ? "all" : venue,
  };
}

function validationSummary(error: { issues: Array<{ path: Array<string | number>; code: string }> }) {
  return error.issues.slice(0, 8).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
  }));
}

async function requestJsonIntent(
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
        max_tokens: 500,
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
      "O DeepSeek retornou uma intenção vazia ou incompleta.",
    );
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new AnalysisPipelineError("INVALID_DEEPSEEK_OUTPUT", "O DeepSeek retornou JSON inválido.");
  }
}

function resolveParsedIntent(
  parsed: ReturnType<typeof deepSeekIntentResponseSchema.safeParse>,
): QueryIntentInput {
  if (!parsed.success) {
    throw new AnalysisPipelineError(
      "INVALID_DEEPSEEK_OUTPUT",
      "A intenção produzida pelo DeepSeek não passou pela validação de segurança.",
    );
  }

  if ("error" in parsed.data) {
    if (parsed.data.error === "unsupported_metric") {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_METRIC",
        `A métrica "${parsed.data.metric}" ainda não é suportada nesta fase.`,
      );
    }
    throw new AnalysisPipelineError(
      "QUESTION_NOT_UNDERSTOOD",
      "Não conseguimos compreender a pergunta com segurança suficiente para consultar dados reais.",
    );
  }

  return parsed.data;
}

function assertMetricCompatible(normalized: unknown): void {
  const record = asRecord(normalized);
  if (!record || typeof record.metric !== "string") return;
  const metric = record.metric;
  if (!SUPPORTED_METRICS.includes(metric as (typeof SUPPORTED_METRICS)[number])) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_METRIC",
      `A métrica "${metric}" ainda não é suportada nesta fase.`,
    );
  }
  if (
    record.entity_type === "player" &&
    !PLAYER_METRICS.includes(metric as (typeof PLAYER_METRICS)[number])
  ) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_METRIC",
      `A métrica "${metric}" ainda não é suportada para jogadores nesta fase.`,
    );
  }
}

export async function parseIntentWithDeepSeek(question: string): Promise<QueryIntentInput> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "A integração com o DeepSeek não está configurada no servidor.",
    );
  }

  const raw = await requestJsonIntent(SYSTEM_PROMPT, question, apiKey);
  const normalized = normalizeIntentCandidate(raw);
  assertMetricCompatible(normalized);
  const firstPass = deepSeekIntentResponseSchema.safeParse(normalized);
  if (firstPass.success) return resolveParsedIntent(firstPass);

  console.warn("[deepseek-intent] first-pass validation failed", {
    issues: validationSummary(firstPass.error),
    keys: asRecord(raw) ? Object.keys(asRecord(raw)!).slice(0, 16) : [],
  });

  const repairedRaw = await requestJsonIntent(
    REPAIR_PROMPT,
    `Pergunta original: ${question}\nJSON a corrigir: ${JSON.stringify(raw)}\nErros de validação: ${JSON.stringify(validationSummary(firstPass.error))}`,
    apiKey,
  );
  const repaired = normalizeIntentCandidate(repairedRaw);
  assertMetricCompatible(repaired);
  const secondPass = deepSeekIntentResponseSchema.safeParse(repaired);

  if (!secondPass.success) {
    console.warn("[deepseek-intent] repair validation failed", {
      issues: validationSummary(secondPass.error),
      keys: asRecord(repairedRaw) ? Object.keys(asRecord(repairedRaw)!).slice(0, 16) : [],
    });
  }

  return resolveParsedIntent(secondPass);
}

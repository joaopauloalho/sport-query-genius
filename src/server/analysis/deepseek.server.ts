import {
  SUPPORTED_METRICS,
  deepSeekIntentResponseSchema,
  type QueryIntentInput,
} from "./intent-schema";
import { AnalysisPipelineError } from "./errors";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `Você é um parser de intenção para uma plataforma de estatísticas esportivas.
Sua única função é converter a pergunta do usuário em JSON. Não responda estatísticas, não estime números,
não consulte dados, não gere SQL, não gere URLs e não adicione campos fora do formato solicitado.

Formato JSON aceito quando a pergunta puder ser interpretada:
{
  "sport": "football",
  "entity_type": "team",
  "entity_name": "Corinthians",
  "metric": "corners",
  "aggregation": "average",
  "match_count": 5,
  "competition": null,
  "venue": "all"
}

Exemplos de interpretação, sem responder nenhum número esportivo:
- "Qual foi a média de escanteios do Corinthians nos últimos 5 jogos?"
  => metric="corners", aggregation="average", match_count=5
- "Quantos escanteios o Corinthians teve no total nos últimos 5 jogos?"
  => metric="corners", aggregation="total", match_count=5
- "Qual foi a média de finalizações do Corinthians nos últimos 5 jogos?"
  => metric="shots", aggregation="average", match_count=5

Restrições:
- sport: somente "football"
- entity_type: somente "team"
- metric: somente "corners", "goals", "shots", "shots_on_target", "cards"
- aggregation: somente "average", "total", "median"
- match_count: inteiro entre 3 e 20
- venue: somente "all", "home", "away"
- competition: texto explícito da pergunta ou null

Se a pergunta não puder ser compreendida com segurança, devolva exatamente:
{"error":"question_not_understood"}

Se a pergunta pedir uma métrica esportiva que não está na lista permitida, devolva:
{"error":"unsupported_metric","metric":"nome pedido"}

A resposta deve conter apenas JSON válido.`;

const REPAIR_PROMPT = `Você corrige JSON de intenção para uma plataforma de estatísticas esportivas.
Retorne somente JSON válido, sem comentários e sem markdown.

Contrato permitido:
- sport: "football"
- entity_type: "team"
- entity_name: string
- metric: "corners" | "goals" | "shots" | "shots_on_target" | "cards"
- aggregation: "average" | "total" | "median"
- match_count: inteiro de 3 a 20
- competition: string ou null
- venue: "all" | "home" | "away"

Se a métrica pedida não estiver no contrato, retorne:
{"error":"unsupported_metric","metric":"nome pedido"}

Se não for possível corrigir com segurança, retorne:
{"error":"question_not_understood"}

Nunca invente uma métrica suportada para substituir uma métrica diferente pedida pelo usuário.`;

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
    if (record.error === "question_not_understood") {
      return { error: "question_not_understood" };
    }
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

  let matchCount = record.match_count;
  if (typeof matchCount === "string" && /^\d+$/.test(matchCount.trim())) {
    matchCount = Number(matchCount.trim());
  }

  let competition = record.competition;
  if (typeof competition === "string") {
    const trimmed = competition.trim();
    const normalized = normalizeToken(trimmed);
    competition = ["", "all", "todas", "todos", "qualquer", "none", "null"].includes(normalized)
      ? null
      : trimmed;
  }

  return {
    sport,
    entity_type: entityType,
    entity_name: typeof record.entity_name === "string" ? record.entity_name.trim() : record.entity_name,
    metric,
    aggregation,
    match_count: matchCount,
    competition: competition ?? null,
    venue,
  };
}

function validationSummary(error: { issues: Array<{ path: Array<string | number>; code: string }> }) {
  return error.issues.slice(0, 8).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
  }));
}

async function requestJsonIntent(systemPrompt: string, userContent: string, apiKey: string): Promise<unknown> {
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
        max_tokens: 400,
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
    throw new AnalysisPipelineError(
      "INVALID_DEEPSEEK_OUTPUT",
      "O DeepSeek retornou JSON inválido.",
    );
  }
}

function resolveParsedIntent(parsed: ReturnType<typeof deepSeekIntentResponseSchema.safeParse>): QueryIntentInput {
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
  const firstPass = deepSeekIntentResponseSchema.safeParse(normalized);

  if (firstPass.success) {
    return resolveParsedIntent(firstPass);
  }

  const normalizedRecord = asRecord(normalized);
  const metric = normalizedRecord?.metric;
  if (typeof metric === "string" && !SUPPORTED_METRICS.includes(metric as (typeof SUPPORTED_METRICS)[number])) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_METRIC",
      `A métrica "${metric}" ainda não é suportada nesta fase.`,
    );
  }

  console.warn("[deepseek-intent] first-pass validation failed", {
    issues: validationSummary(firstPass.error),
    keys: asRecord(raw) ? Object.keys(asRecord(raw)!).slice(0, 16) : [],
    normalizedMetric: typeof metric === "string" ? metric : null,
  });

  const repairedRaw = await requestJsonIntent(
    REPAIR_PROMPT,
    `Pergunta original: ${question}\nJSON a corrigir: ${JSON.stringify(raw)}\nErros de validação: ${JSON.stringify(validationSummary(firstPass.error))}`,
    apiKey,
  );
  const repaired = normalizeIntentCandidate(repairedRaw);
  const secondPass = deepSeekIntentResponseSchema.safeParse(repaired);

  if (!secondPass.success) {
    console.warn("[deepseek-intent] repair validation failed", {
      issues: validationSummary(secondPass.error),
      keys: asRecord(repairedRaw) ? Object.keys(asRecord(repairedRaw)!).slice(0, 16) : [],
    });
  }

  return resolveParsedIntent(secondPass);
}

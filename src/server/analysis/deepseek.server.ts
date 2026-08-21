import { deepSeekIntentResponseSchema, type QueryIntentInput } from "./intent-schema";
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

type DeepSeekResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
};

export async function parseIntentWithDeepSeek(question: string): Promise<QueryIntentInput> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AnalysisPipelineError(
      "DEEPSEEK_ERROR",
      "A integração com o DeepSeek não está configurada no servidor.",
    );
  }

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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
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

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new AnalysisPipelineError(
      "INVALID_DEEPSEEK_OUTPUT",
      "O DeepSeek retornou JSON inválido.",
    );
  }

  const parsed = deepSeekIntentResponseSchema.safeParse(raw);
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

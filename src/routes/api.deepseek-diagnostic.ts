import { createFileRoute } from "@tanstack/react-router";

import { parseIntentWithDeepSeek } from "@/server/analysis/deepseek.server";
import { toSafeAnalysisError } from "@/server/analysis/errors";

const QUESTIONS = [
  "Quantos gols o Corinthians fez nos últimos cinco jogos?",
  "Qual a média de escanteios do Corinthians nos últimos 5 jogos?",
  "Quantas vitórias o Corinthians teve nos últimos 5 jogos?",
  "Qual a mediana de finalizações no alvo do Corinthians nos últimos 7 jogos?",
  "Quantos cartões o Corinthians recebeu nos últimos 5 jogos?",
] as const;

export const Route = createFileRoute("/api/deepseek-diagnostic")({
  server: {
    handlers: {
      GET: async () => {
        const results = [];

        for (const question of QUESTIONS) {
          try {
            results.push({ question, ok: true, intent: await parseIntentWithDeepSeek(question) });
          } catch (error) {
            results.push({ question, ok: false, ...toSafeAnalysisError(error) });
          }
        }

        return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});

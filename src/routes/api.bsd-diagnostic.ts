import { createFileRoute } from "@tanstack/react-router";

import { analyzeQuestion } from "@/lib/analysis.functions";

const QUESTION = "Qual foi a média de escanteios do Corinthians nos últimos 5 jogos?";

export const Route = createFileRoute("/api/bsd-diagnostic")({
  server: {
    handlers: {
      GET: async () => {
        const outcome = await analyzeQuestion({ data: { question: QUESTION } });
        return Response.json(
          { question: QUESTION, outcome },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

import { analyzeQuestion } from "@/lib/analysis.functions";
import type { AnalysisRequest } from "@/lib/analysis-request";

const CASES = {
  A: {
    question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos?",
    overrides: { match_count: 5 },
  },
  B: {
    question: "Qual a média de escanteios do Corinthians nos últimos 10 jogos?",
    overrides: { match_count: 10 },
  },
  C: {
    question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos em casa?",
    overrides: { match_count: 5, venue: "home" },
  },
  D: {
    question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos fora de casa?",
    overrides: { match_count: 5, venue: "away" },
  },
  E: {
    question: "Qual o total de gols do Corinthians nos últimos 10 jogos?",
    overrides: { match_count: 10 },
  },
  F: {
    question: "Qual a média de finalizações do Corinthians nos últimos 5 jogos?",
    overrides: { match_count: 5 },
  },
  G: {
    question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos?",
    overrides: { match_count: 5, competition: "brasileirao" },
  },
} satisfies Record<string, AnalysisRequest>;

type ValidationCase = keyof typeof CASES;

export const Route = createFileRoute("/api/phase2a-validation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = new URL(request.url).searchParams.get("case")?.toUpperCase() as ValidationCase | undefined;
        if (!key || !(key in CASES)) {
          return Response.json({ error: "Use case=A..G" }, { status: 400 });
        }

        const input = CASES[key];
        const outcome = await analyzeQuestion({ data: input });
        return Response.json(
          { case: key, input, outcome },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

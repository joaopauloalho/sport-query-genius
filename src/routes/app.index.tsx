import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, BarChart3, Clock, Home, Target, Trophy } from "lucide-react";

import { SmartSearch } from "@/components/scoutly/smart-search";
import { MethodologyNote } from "@/components/scoutly/source-badge";
import type { AnalysisOverrides } from "@/lib/analysis-request";
import { useScoutly } from "@/lib/store";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Início — Scoutly AI" },
      {
        name: "description",
        content:
          "Faça perguntas sobre equipes de futebol e analise dados reais por período, competição e mando.",
      },
      { property: "og:title", content: "Início — Scoutly AI" },
      { property: "og:description", content: "O painel de pesquisa esportiva da Scoutly AI." },
    ],
  }),
  component: Dashboard,
});

const SUGGESTIONS = [
  {
    icon: Trophy,
    label: "Corinthians · escanteios",
    question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos?",
  },
  {
    icon: Target,
    label: "Flamengo · finalizações",
    question: "Qual a média de finalizações do Flamengo nos últimos 5 jogos?",
  },
  {
    icon: BarChart3,
    label: "Palmeiras · cartões",
    question: "Qual a média de cartões do Palmeiras nos últimos 10 jogos?",
  },
  {
    icon: Trophy,
    label: "Real Madrid · gols",
    question: "Qual a média de gols do Real Madrid nos últimos 10 jogos?",
  },
  {
    icon: Target,
    label: "Liverpool · no alvo",
    question: "Qual a média de finalizações no alvo do Liverpool nos últimos 5 jogos?",
  },
  {
    icon: Home,
    label: "Corinthians · em casa",
    question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos em casa?",
  },
];

const READY_QUESTIONS = [
  {
    title: "Escanteios do Corinthians",
    question: "Qual foi a média de escanteios do Corinthians nos últimos 5 jogos?",
    tag: "Futebol · Equipe",
  },
  {
    title: "Finalizações do Flamengo",
    question: "Qual foi a média de finalizações do Flamengo nos últimos 5 jogos?",
    tag: "Futebol · Equipe",
  },
  {
    title: "Cartões do Palmeiras",
    question: "Qual foi a média de cartões do Palmeiras nos últimos 10 jogos?",
    tag: "Futebol · Equipe",
  },
  {
    title: "Gols do Real Madrid",
    question: "Qual foi o total de gols do Real Madrid nos últimos 10 jogos?",
    tag: "Futebol · Equipe",
  },
  {
    title: "Liverpool no alvo",
    question: "Qual foi a média de finalizações no alvo do Liverpool nos últimos 5 jogos?",
    tag: "Futebol · Equipe",
  },
  {
    title: "Corinthians em casa",
    question: "Qual foi a média de escanteios do Corinthians nos últimos 5 jogos em casa?",
    tag: "Futebol · Casa/Fora",
  },
];

function Dashboard() {
  const navigate = useNavigate();
  const { history } = useScoutly();

  const ask = (question: string, overrides?: AnalysisOverrides) =>
    navigate({
      to: "/app/resultado",
      search: {
        q: question,
        match_count: overrides?.match_count,
        competition:
          overrides && Object.prototype.hasOwnProperty.call(overrides, "competition")
            ? (overrides.competition ?? "all")
            : undefined,
        venue: overrides?.venue,
      },
    });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="text-center">
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">
          O que você quer descobrir hoje?
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
          Analise equipes de futebol por período, competição e mando de campo usando dados reais.
        </p>
      </section>

      <div className="mt-8">
        <SmartSearch
          autoFocus
          onSubmit={(question, _filters, overrides) => ask(question, overrides)}
        />
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            onClick={() => ask(suggestion.question)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary"
          >
            <suggestion.icon className="size-3.5" />
            {suggestion.label}
          </button>
        ))}
      </div>

      <section className="mt-14">
        <div>
          <h2 className="text-lg font-semibold">Perguntas prontas</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Atalhos para executar o mesmo motor real de análise, sem resultados pré-calculados ou
            simulados.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {READY_QUESTIONS.map((analysis) => (
            <button
              key={analysis.title}
              onClick={() => ask(analysis.question)}
              className="surface-card group animate-rise p-4 text-left transition-colors hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.7rem] text-muted-foreground">
                  {analysis.tag}
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>
              <h3 className="mt-3 text-sm font-semibold">{analysis.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                {analysis.question}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="surface-card mt-12 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="size-4 text-primary" /> Consultas recentes da sua conta
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          O histórico é persistido no Supabase e acompanha sua sessão em outros navegadores.
        </p>
        {history.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Suas análises aparecerão aqui depois da primeira consulta real.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {history.slice(0, 5).map((historyEntry) => (
              <li key={historyEntry.id}>
                <button
                  onClick={() => ask(historyEntry.question)}
                  className="w-full rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-secondary"
                >
                  <span className="block truncate">{historyEntry.question}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MethodologyNote className="mt-10" />
    </div>
  );
}

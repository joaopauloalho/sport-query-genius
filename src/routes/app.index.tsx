import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BarChart3,
  Clock,
  Flame,
  GitCompareArrows,
  Home,
  Trophy,
  Users,
} from "lucide-react";

import { SmartSearch } from "@/components/scoutly/smart-search";
import { DemoBadge, MethodologyNote } from "@/components/scoutly/source-badge";
import { Button } from "@/components/ui/button";
import { FEATURED_ANALYSES, TEAMS } from "@/data/sports";
import { useScoutly } from "@/lib/store";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Início — Scoutly AI" },
      { name: "description", content: "Faça perguntas sobre jogadores, equipes, partidas e competições." },
      { property: "og:title", content: "Início — Scoutly AI" },
      { property: "og:description", content: "O painel de pesquisa esportiva da Scoutly AI." },
    ],
  }),
  component: Dashboard,
});

const SUGGESTIONS = [
  { icon: GitCompareArrows, label: "Comparar dois jogadores", question: "Compare Nico Williams e Lamine Yamal em faltas recebidas nos últimos 10 jogos" },
  { icon: Clock, label: "Analisar últimos jogos", question: "Qual a média de finalizações do Liverpool nos últimos 15 jogos?" },
  { icon: Trophy, label: "Encontrar líderes de uma estatística", question: "Média de finalizações no alvo de Erling Haaland nos últimos 10 jogos" },
  { icon: Home, label: "Comparar casa e fora", question: "Mostre o desempenho do Flamengo em jogos fora de casa" },
  { icon: BarChart3, label: "Analisar uma equipe", question: "Qual a média de gols do Real Madrid nos últimos 20 jogos?" },
  { icon: Users, label: "Explorar uma competição", question: "Média de cartões do Barcelona em La Liga nos últimos 15 jogos" },
];

function Dashboard() {
  const navigate = useNavigate();
  const { profile, history, usage, quota } = useScoutly();

  const ask = (question: string) =>
    navigate({ to: "/app/resultado", search: { q: question } });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="text-center">
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">O que você quer descobrir hoje?</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
          Faça perguntas sobre jogadores, equipes, partidas e competições.
        </p>
      </section>

      <div className="mt-8">
        <SmartSearch autoFocus onSubmit={(q) => ask(q)} />
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => ask(s.question)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary"
          >
            <s.icon className="size-3.5" />
            {s.label}
          </button>
        ))}
      </div>

      <section className="mt-14">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
          <h2 className="min-w-0 truncate text-lg font-semibold">Análises em destaque</h2>
          <DemoBadge className="shrink-0" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURED_ANALYSES.map((f) => (
            <button
              key={f.title}
              onClick={() => ask(f.question)}
              className="surface-card group animate-rise p-4 text-left transition-colors hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.7rem] text-muted-foreground">
                  {f.tag}
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>
              <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{f.question}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="surface-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-primary" /> Consultas recentes
          </h2>
          {history.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Suas análises aparecerão aqui. Comece com uma das sugestões acima.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {history.slice(0, 5).map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => ask(h.question)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    <span className="min-w-0 truncate">{h.question}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {h.cached ? "cache" : "nova"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="surface-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Flame className="size-4 text-lime" /> Seu plano
          </h2>
          <p className="mt-4 font-display text-2xl font-bold tabular-nums">
            {usage}
            <span className="text-sm font-normal text-muted-foreground"> / {quota} análises</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Uso do mês corrente.</p>
          <p className="mt-4 text-xs text-muted-foreground">
            Equipes acompanhadas:{" "}
            {profile.favoriteTeams
              .map((id) => TEAMS.find((t) => t.id === id)?.name)
              .filter(Boolean)
              .join(", ") || "nenhuma"}
          </p>
          <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => navigate({ to: "/precos" })}>
            Ver planos
          </Button>
        </div>
      </section>

      <MethodologyNote className="mt-10" />
    </div>
  );
}

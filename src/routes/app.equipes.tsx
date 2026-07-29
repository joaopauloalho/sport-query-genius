import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { MetricCard } from "@/components/scoutly/metric-card";
import { PerformanceChart } from "@/components/scoutly/performance-chart";
import { DemoBadge } from "@/components/scoutly/source-badge";
import { Button } from "@/components/ui/button";
import { PLAYERS, TEAMS, getCompetition } from "@/data/sports";
import { runAnalysis } from "@/lib/analysis";
import { useScoutly } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/equipes")({
  head: () => ({
    meta: [
      { title: "Equipes — Scoutly AI" },
      { name: "description", content: "Forma recente, desempenho em casa e fora, gols, escanteios e cartões por equipe." },
      { property: "og:title", content: "Equipes — Scoutly AI" },
      { property: "og:description", content: "Perfis de equipes com métricas recentes." },
    ],
  }),
  component: TeamsPage,
});

const METRIC_QUESTIONS = ["gols", "gols sofridos", "escanteios", "cartões", "finalizações"];

function TeamsPage() {
  const navigate = useNavigate();
  const { saved } = useScoutly();
  const [teamId, setTeamId] = useState(TEAMS[0].id);
  const team = TEAMS.find((t) => t.id === teamId)!;

  const analyses = useMemo(
    () =>
      METRIC_QUESTIONS.map((m) => ({
        metric: m,
        outcome: runAnalysis(`Média de ${m} do ${team.name} nos últimos 10 jogos`),
      })),
    [team],
  );

  const main = analyses[0].outcome;
  const ask = (q: string) => navigate({ to: "/app/resultado", search: { q } });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Equipes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Perfil completo com métricas do período recente.</p>
        </div>
        <DemoBadge className="shrink-0" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {TEAMS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTeamId(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
              t.id === teamId ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:border-primary/40",
            )}
          >
            <span
              className="grid size-6 place-items-center rounded-md text-[0.6rem] font-bold text-background"
              style={{ background: t.colors[0] }}
            >
              {t.shortName}
            </span>
            {t.name}
          </button>
        ))}
      </div>

      <section className="surface-card mt-6 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="grid size-14 shrink-0 place-items-center rounded-2xl font-display text-sm font-bold text-background"
            style={{ background: team.colors[0] }}
          >
            {team.shortName}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{team.name}</h2>
            <p className="text-sm text-muted-foreground">
              {team.country} · {getCompetition(team.competitionId)?.name} · fundado em {team.founded}
            </p>
            <div className="mt-3 flex gap-1">
              {["V", "V", "D", "E", "V"].map((r, i) => (
                <span
                  key={i}
                  className={cn(
                    "grid size-6 place-items-center rounded-md text-[0.7rem] font-bold",
                    r === "V" ? "bg-success/20 text-success" : r === "D" ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning",
                  )}
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
          <Button size="sm" onClick={() => ask(`Qual a média de escanteios do ${team.name} nos últimos 20 jogos?`)}>
            Perguntar sobre o time
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {analyses.map((a) =>
            a.outcome.ok ? (
              <MetricCard
                key={a.metric}
                label={a.metric}
                value={a.outcome.result.statistics.average}
                hint="média por jogo"
              />
            ) : null,
          )}
        </div>

        {main.ok && (
          <div className="mt-6">
            <PerformanceChart data={main.result.chart_data} height={220} average={main.result.statistics.average} />
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold">Jogadores em destaque</h3>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {PLAYERS.filter((p) => p.teamId === team.id).map((p) => (
                <li key={p.id}>{p.name} · {p.position}</li>
              ))}
              {PLAYERS.filter((p) => p.teamId === team.id).length === 0 && (
                <li>Elenco demonstrativo ainda não conectado à API esportiva.</li>
              )}
            </ul>
          </div>
          <div className="rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold">Análises salvas relacionadas</h3>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {saved.filter((s) => s.intent.entity_id === team.id).map((s) => (
                <li key={s.cache_key} className="truncate">{s.question}</li>
              ))}
              {saved.filter((s) => s.intent.entity_id === team.id).length === 0 && (
                <li>Nenhuma análise salva para esta equipe ainda.</li>
              )}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

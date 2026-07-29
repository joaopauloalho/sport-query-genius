import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarClock, Radio } from "lucide-react";
import { useState } from "react";

import { DemoBadge } from "@/components/scoutly/source-badge";
import { Button } from "@/components/ui/button";
import { FIXTURES, getCompetition, getTeam } from "@/data/sports";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/jogos")({
  head: () => ({
    meta: [
      { title: "Jogos — Scoutly AI" },
      { name: "description", content: "Partidas recentes e próximas com retrospecto, forma recente e estatísticas." },
      { property: "og:title", content: "Jogos — Scoutly AI" },
      { property: "og:description", content: "Analise partidas recentes e próximas." },
    ],
  }),
  component: MatchesPage,
});

const STATUS_LABEL = { finished: "Encerrado", live: "Ao vivo", scheduled: "Agendado" } as const;

function MatchesPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const fixture = FIXTURES.find((f) => f.id === selected) ?? null;

  const ask = (q: string) => navigate({ to: "/app/resultado", search: { q } });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Jogos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Partidas recentes e próximas.</p>
        </div>
        <DemoBadge className="shrink-0" />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIXTURES.map((f) => {
          const home = getTeam(f.homeId)!;
          const away = getTeam(f.awayId)!;
          return (
            <div key={f.id} className="surface-card animate-rise p-4">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{getCompetition(f.competitionId)?.name}</span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5",
                    f.status === "live" ? "bg-destructive/15 text-destructive" : "bg-secondary",
                  )}
                >
                  {f.status === "live" ? <Radio className="size-3" /> : <CalendarClock className="size-3" />}
                  {STATUS_LABEL[f.status]}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                {[home, away].map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5">
                    <span
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-[0.65rem] font-bold text-background"
                      style={{ background: t.colors[0] }}
                    >
                      {t.shortName}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                {new Date(f.kickoff).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                {f.score ? ` · ${f.score}` : ""}
              </p>

              <Button size="sm" variant="outline" className="mt-4 w-full" onClick={() => setSelected(f.id)}>
                Analisar este jogo
              </Button>
            </div>
          );
        })}
      </div>

      {fixture && (
        <section className="surface-card mt-8 p-5">
          <h2 className="text-lg font-semibold">
            {getTeam(fixture.homeId)!.name} × {getTeam(fixture.awayId)!.name}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {getCompetition(fixture.competitionId)?.name} ·{" "}
            {new Date(fixture.kickoff).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[fixture.homeId, fixture.awayId].map((id) => {
              const team = getTeam(id)!;
              return (
                <div key={id} className="rounded-xl border border-border p-4">
                  <h3 className="text-sm font-semibold">{team.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {team.country} · fundado em {team.founded}
                  </p>
                  <div className="mt-3 flex gap-1">
                    {["V", "V", "E", "D", "V"].map((r, i) => (
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
                  <p className="mt-3 text-xs text-muted-foreground">
                    Escalação demonstrativa e principais jogadores serão conectados à API esportiva real.
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[
              `Qual a média de escanteios do ${getTeam(fixture.homeId)!.name} nos últimos 10 jogos?`,
              `Mostre o desempenho do ${getTeam(fixture.awayId)!.name} em jogos fora de casa`,
              `Qual a média de gols do ${getTeam(fixture.homeId)!.name} nos últimos 15 jogos?`,
            ].map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="rounded-full border border-border bg-card px-3.5 py-2 text-xs transition-colors hover:border-primary/50 hover:text-primary"
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

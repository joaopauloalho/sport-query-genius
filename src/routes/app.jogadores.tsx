import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { MetricCard } from "@/components/scoutly/metric-card";
import { PerformanceChart } from "@/components/scoutly/performance-chart";
import { DemoBadge } from "@/components/scoutly/source-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLAYERS, getSport, getTeam } from "@/data/sports";
import { runAnalysis } from "@/lib/analysis";

export const Route = createFileRoute("/app/jogadores")({
  head: () => ({
    meta: [
      { title: "Jogadores — Scoutly AI" },
      { name: "description", content: "Perfis de jogadores com médias recentes, gráficos de desempenho e comparação lado a lado." },
      { property: "og:title", content: "Jogadores — Scoutly AI" },
      { property: "og:description", content: "Perfis, médias recentes e comparação de jogadores." },
    ],
  }),
  component: PlayersPage,
});

const COMPARE_METRICS = [
  "Jogos", "Minutos", "Gols", "Assistências", "Finalizações", "Finalizações no alvo",
  "Passes decisivos", "Faltas recebidas", "Dribles", "Cartões",
];

function statFor(seedName: string, index: number): number {
  let h = 0;
  for (const ch of seedName + index) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return Math.round((h / 997) * 100) / 10;
}

function PlayersPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(PLAYERS[0].id);
  const [compareId, setCompareId] = useState(PLAYERS[1].id);

  const filtered = PLAYERS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  const player = PLAYERS.find((p) => p.id === selectedId)!;
  const metricLabel = getSport(player.sport).metrics[0].label;

  const analysis = useMemo(
    () => runAnalysis(`Média de ${metricLabel.toLowerCase()} de ${player.name} nos últimos 10 jogos`),
    [player, metricLabel],
  );

  const ask = (q: string) => navigate({ to: "/app/resultado", search: { q } });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Jogadores</h1>
          <p className="mt-1 text-sm text-muted-foreground">Busque um perfil ou compare dois jogadores.</p>
        </div>
        <DemoBadge className="shrink-0" />
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar jogador"
        aria-label="Buscar jogador"
        className="mt-6"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {filtered.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              p.id === selectedId ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <span className="grid size-6 place-items-center rounded-full bg-secondary text-[0.6rem] font-bold">
              {p.initials}
            </span>
            {p.name}
          </button>
        ))}
      </div>

      <section className="surface-card mt-6 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/15 font-display text-lg font-bold text-primary">
            {player.initials}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{player.name}</h2>
            <p className="text-sm text-muted-foreground">
              {getTeam(player.teamId ?? "")?.name ?? "Circuito individual"} · {player.position} · {player.nationality} · {player.age} anos
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => ask(`Média de ${metricLabel.toLowerCase()} de ${player.name} nos últimos 10 jogos`)}
          >
            Perguntar sobre {player.name.split(" ")[0]}
          </Button>
        </div>

        {analysis.ok && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label={`Média de ${metricLabel.toLowerCase()}`} value={analysis.result.statistics.average} emphasis />
              <MetricCard label="Mediana" value={analysis.result.statistics.median} />
              <MetricCard label="Máximo" value={analysis.result.statistics.maximum} />
              <MetricCard label="Jogos" value={analysis.result.statistics.sample_size} />
            </div>
            <div className="mt-6">
              <PerformanceChart data={analysis.result.chart_data} height={220} average={analysis.result.statistics.average} />
            </div>
          </>
        )}
      </section>

      <section className="surface-card mt-6 p-5">
        <h2 className="text-sm font-semibold">Comparar jogadores</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger aria-label="Jogador A"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLAYERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={compareId} onValueChange={setCompareId}>
            <SelectTrigger aria-label="Jogador B"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLAYERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-5 space-y-2">
          {COMPARE_METRICS.map((m, i) => {
            const a = statFor(selectedId, i);
            const b = statFor(compareId, i);
            const total = a + b || 1;
            return (
              <div key={m} className="grid grid-cols-[3rem_1fr_3rem] items-center gap-3 text-xs">
                <span className="text-right font-semibold tabular-nums">{a}</span>
                <div>
                  <p className="mb-1 text-center text-muted-foreground">{m}</p>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary">
                    <span className="bg-chart-1" style={{ width: `${(a / total) * 100}%` }} />
                    <span className="bg-chart-2" style={{ width: `${(b / total) * 100}%` }} />
                  </div>
                </div>
                <span className="font-semibold tabular-nums">{b}</span>
              </div>
            );
          })}
        </div>

        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={() =>
            ask(
              `Compare ${PLAYERS.find((p) => p.id === selectedId)!.name} e ${PLAYERS.find((p) => p.id === compareId)!.name} em faltas recebidas nos últimos 10 jogos`,
            )
          }
        >
          Gerar análise comparativa completa
        </Button>
      </section>
    </div>
  );
}

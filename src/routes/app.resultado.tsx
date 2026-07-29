import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  Download,
  RefreshCw,
  Share2,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MatchesTable } from "@/components/scoutly/matches-table";
import { MetricCard } from "@/components/scoutly/metric-card";
import { PerformanceChart } from "@/components/scoutly/performance-chart";
import { SmartSearch } from "@/components/scoutly/smart-search";
import { DemoBadge, MethodologyNote, SourceBadge } from "@/components/scoutly/source-badge";
import { EmptyState, ProcessingSteps } from "@/components/scoutly/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCompetition, getSport } from "@/data/sports";
import { buildCacheKey, parseIntent, runAnalysis, toCsv, type AnalysisResult } from "@/lib/analysis";
import { useScoutly } from "@/lib/store";

export const Route = createFileRoute("/app/resultado")({
  validateSearch: (search: Record<string, unknown>) => ({ q: String(search.q ?? "") }),
  head: () => ({
    meta: [
      { title: "Resultado da análise — Scoutly AI" },
      { name: "description", content: "Resposta, números, gráfico, tabela e insights da sua pergunta esportiva." },
      { property: "og:title", content: "Resultado da análise — Scoutly AI" },
      { property: "og:description", content: "Análise esportiva estruturada gerada pela Scoutly AI." },
    ],
  }),
  component: ResultPage,
});

function ResultPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const { registerAnalysis, getCached, toggleSaved, isSaved, workspaces, addToWorkspace } = useScoutly();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setResult(null);

    const intent = parseIntent(q);
    const key = intent ? buildCacheKey(intent) : null;
    const hit = key ? getCached(key) : undefined;

    const timer = setTimeout(
      () => {
        if (!alive) return;
        if (hit) {
          setResult(hit);
          setCached(true);
          registerAnalysis(hit, true);
        } else {
          const outcome = runAnalysis(q);
          if (outcome.ok) {
            setResult(outcome.result);
            setCached(false);
            registerAnalysis(outcome.result, false);
          } else {
            setError(outcome.reason);
          }
        }
        setLoading(false);
      },
      hit ? 240 : 1200,
    );

    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const ask = (question: string) => navigate({ to: "/app/resultado", search: { q: question } });

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <p className="mb-6 text-center text-sm text-muted-foreground">“{q}”</p>
        <ProcessingSteps />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-14 sm:px-6">
        <SmartSearch defaultValue={q} showFilters={false} size="sm" onSubmit={(question) => ask(question)} />
        <EmptyState title="Dados insuficientes" description={error ?? "Tente reformular a pergunta."} />
      </div>
    );
  }

  const sport = getSport(result.intent.sport);
  const competition = getCompetition(result.intent.competition);
  const saved = isSaved(result.cache_key);

  function exportCsv() {
    if (!result) return;
    const blob = new Blob([toCsv(result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scoutly-${result.cache_key.replace(/\|/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado.");
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <SmartSearch defaultValue={q} showFilters={false} size="sm" onSubmit={(question) => ask(question)} />

      {/* Cabeçalho da análise */}
      <header className="surface-card p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-balance sm:text-xl">{result.question}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Trophy className="size-3.5" />
                {sport.name}
                {competition ? ` · ${competition.name}` : ""}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                Últimos {result.statistics.sample_size} jogos
                {result.intent.venue !== "all" && (result.intent.venue === "home" ? " · em casa" : " · fora de casa")}
              </span>
              <span>
                Consulta em{" "}
                {new Date(result.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </span>
              {cached && (
                <span className="inline-flex items-center gap-1 rounded-full bg-lime/10 px-2 py-0.5 text-lime">
                  <Zap className="size-3" /> Resultado em cache
                </span>
              )}
            </div>
          </div>
          <DemoBadge className="shrink-0" />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" variant={saved ? "default" : "outline"} className="gap-1.5" onClick={() => toggleSaved(result)}>
            {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            {saved ? "Salva" : "Salvar"}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShareOpen(true)}>
            <Share2 className="size-4" /> Compartilhar
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}>
            <Download className="size-4" /> Exportar CSV
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => ask(q)}>
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        </div>
      </header>

      {/* Resposta principal */}
      <section className="surface-card border-primary/30 bg-primary/5 p-6">
        <p className="font-display text-xl leading-snug font-semibold text-balance sm:text-2xl">
          {result.answer.summary}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{result.answer.explanation}</p>
      </section>

      {/* Números principais */}
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Números principais</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Média" value={result.statistics.average} emphasis />
          <MetricCard label="Mediana" value={result.statistics.median} />
          <MetricCard label="Total" value={result.statistics.total} />
          <MetricCard label="Maior valor" value={result.statistics.maximum} />
          <MetricCard label="Menor valor" value={result.statistics.minimum} />
          <MetricCard label="Jogos analisados" value={result.statistics.sample_size} />
          <MetricCard
            label="Tendência recente"
            value={result.statistics.trend > 0 ? `+${result.statistics.trend}` : result.statistics.trend}
            trend={result.statistics.trend}
            hint="Últimos 5 jogos vs. período"
          />
          <MetricCard label="Unidade" value={result.answer.unit.split(" ")[0]} hint={result.intent.metric_label} />
        </div>
      </section>

      {/* Gráfico */}
      <section className="surface-card p-5">
        <PerformanceChart
          data={result.chart_data}
          average={result.statistics.average}
          hasCompare={Boolean(result.compare_matches)}
        />
      </section>

      {/* Tabela */}
      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Partidas analisadas</h2>
        <MatchesTable matches={result.matches} metricLabel={result.intent.metric_label} onExport={exportCsv} />
      </section>

      {/* Insights */}
      <section className="surface-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-lime" /> O que os dados mostram
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {result.insights.map((i) => (
            <li key={i} className="rounded-lg bg-secondary/50 p-3 text-sm">
              {i}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Observações estatísticas sobre o período analisado. Não representam previsão de eventos futuros.
        </p>
      </section>

      {/* Perguntas relacionadas */}
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Perguntas relacionadas
        </h2>
        <div className="flex flex-wrap gap-2">
          {result.related.map((r) => (
            <button
              key={r}
              onClick={() => ask(r)}
              className="rounded-full border border-border bg-card px-3.5 py-2 text-xs transition-colors hover:border-primary/50 hover:text-primary"
            >
              {r}
            </button>
          ))}
        </div>
      </section>

      {/* Confiança nos dados */}
      <section className="surface-card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Confiança nos dados</h2>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <span>Jogos analisados: {result.statistics.sample_size}</span>
          <span>Mando de campo: {result.intent.venue === "all" ? "todos" : result.intent.venue === "home" ? "casa" : "fora"}</span>
          <span>Competição: {competition?.name ?? "todas"}</span>
          <span>Dados ausentes: {result.source.missing}</span>
        </div>
        <SourceBadge updatedAt={result.source.updated_at} />
        <MethodologyNote />
      </section>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compartilhar análise</DialogTitle>
            <DialogDescription>
              Copie o link ou adicione esta análise a um workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                navigator.clipboard?.writeText(
                  `${window.location.origin}/app/resultado?q=${encodeURIComponent(result.question)}`,
                );
                toast.success("Link copiado.");
              }}
            >
              Copiar link
            </Button>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Adicionar a um workspace</p>
              {workspaces.map((w) => (
                <Button
                  key={w.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    addToWorkspace(w.id, result);
                    setShareOpen(false);
                    toast.success(`Análise adicionada a ${w.name}.`);
                  }}
                >
                  {w.name}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

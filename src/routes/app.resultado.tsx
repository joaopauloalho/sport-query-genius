import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  Download,
  RefreshCw,
  Share2,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { MatchesTable } from "@/components/scoutly/matches-table";
import { MetricCard } from "@/components/scoutly/metric-card";
import { PerformanceChart } from "@/components/scoutly/performance-chart";
import { SmartSearch } from "@/components/scoutly/smart-search";
import { DemoBadge, MethodologyNote, RealDataBadge, SourceBadge } from "@/components/scoutly/source-badge";
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
import { toCsv, type AnalysisResult } from "@/lib/analysis";
import {
  SUPPORTED_MATCH_COUNTS,
  type AnalysisOverrides,
  type AnalysisVenue,
  type SupportedMatchCount,
} from "@/lib/analysis-request";
import { analyzeQuestion } from "@/lib/analysis.functions";
import { useScoutly } from "@/lib/store";

function parseMatchCount(value: unknown): SupportedMatchCount | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return SUPPORTED_MATCH_COUNTS.includes(parsed as SupportedMatchCount)
    ? (parsed as SupportedMatchCount)
    : undefined;
}

function parseVenue(value: unknown): AnalysisVenue | undefined {
  return value === "all" || value === "home" || value === "away" ? value : undefined;
}

export const Route = createFileRoute("/app/resultado")({
  validateSearch: (search: Record<string, unknown>) => {
    const rawMatchCount = search.match_count;
    const match_count = parseMatchCount(rawMatchCount);
    const competition =
      typeof search.competition === "string" && search.competition.trim()
        ? search.competition.trim()
        : undefined;
    const venue = parseVenue(search.venue);

    return {
      q: String(search.q ?? ""),
      match_count,
      competition,
      venue,
      invalid_match_count:
        rawMatchCount !== undefined && rawMatchCount !== null && rawMatchCount !== "" && !match_count,
    };
  },
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

const ERROR_TITLES: Record<string, string> = {
  TEAM_NOT_FOUND: "Time não encontrado",
  QUESTION_NOT_UNDERSTOOD: "Pergunta não compreendida",
  UNSUPPORTED_METRIC: "Métrica não suportada",
  UNSUPPORTED_FILTER: "Filtro ainda não suportado",
  API_LIMIT_REACHED: "Limite da API atingido",
  PROVIDER_UNAVAILABLE: "Serviço de dados esportivos indisponível",
  DATA_INSUFFICIENT: "Dados insuficientes",
  DEEPSEEK_ERROR: "Erro ao interpretar pergunta",
  INVALID_DEEPSEEK_OUTPUT: "Saída inválida do DeepSeek",
};

type ResultError = { code?: string; reason: string };

function ResultPage() {
  const { q, match_count, competition, venue, invalid_match_count } = Route.useSearch();
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeQuestion);
  const { registerAnalysis, toggleSaved, isSaved, workspaces, addToWorkspace } = useScoutly();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<ResultError | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const requestOverrides = useMemo<AnalysisOverrides | undefined>(() => {
    const overrides: AnalysisOverrides = {};
    if (match_count !== undefined) overrides.match_count = match_count;
    if (competition !== undefined) overrides.competition = competition === "all" ? null : competition;
    if (venue !== undefined) overrides.venue = venue;
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [match_count, competition, venue]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setResult(null);

    if (q.trim().length < 3) {
      setError({
        code: "QUESTION_NOT_UNDERSTOOD",
        reason: "Digite uma pergunta esportiva com pelo menos três caracteres.",
      });
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    if (invalid_match_count) {
      setError({
        code: "UNSUPPORTED_FILTER",
        reason: "Período não suportado. Use exatamente 5, 10, 15 ou 20 partidas.",
      });
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    void analyze({
      data: {
        question: q,
        ...(requestOverrides ? { overrides: requestOverrides } : {}),
      },
    })
      .then((outcome) => {
        if (!alive) return;
        if (outcome.ok) {
          setResult(outcome.result);
          registerAnalysis(outcome.result, false);
        } else {
          setError({ code: outcome.code, reason: outcome.reason });
        }
      })
      .catch(() => {
        if (!alive) return;
        setError({
          reason: "Não foi possível concluir a análise agora. Nenhuma estatística foi estimada ou inventada.",
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [q, invalid_match_count, requestOverrides, analyze, registerAnalysis]);

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
        <EmptyState
          title={error?.code ? (ERROR_TITLES[error.code] ?? "Não foi possível analisar") : "Não foi possível analisar"}
          description={error?.reason ?? "Tente reformular a pergunta."}
        />
      </div>
    );
  }

  const sport = getSport(result.intent.sport);
  const competitionLabel =
    getCompetition(result.intent.competition)?.name ?? result.intent.competition ?? null;
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

  function copyShareLink() {
    if (!result) return;
    const params = new URLSearchParams({ q: result.question });
    if (match_count !== undefined) params.set("match_count", String(match_count));
    if (competition !== undefined) params.set("competition", competition);
    if (venue !== undefined) params.set("venue", venue);
    navigator.clipboard?.writeText(`${window.location.origin}/app/resultado?${params.toString()}`);
    toast.success("Link copiado.");
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <SmartSearch defaultValue={q} showFilters={false} size="sm" onSubmit={(question) => ask(question)} />

      <header className="surface-card p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-balance sm:text-xl">{result.question}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Trophy className="size-3.5" />
                {sport.name}
                {competitionLabel ? ` · ${competitionLabel}` : ""}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                {result.statistics.sample_size} partidas analisadas
                {result.intent.venue !== "all" && (result.intent.venue === "home" ? " · em casa" : " · fora de casa")}
              </span>
              <span>
                Consulta em{" "}
                {new Date(result.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
          </div>
          {result.demo ? <DemoBadge className="shrink-0" /> : <RealDataBadge className="shrink-0" />}
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
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => ask(q, requestOverrides)}>
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        </div>
      </header>

      <section className="surface-card border-primary/30 bg-primary/5 p-6">
        <p className="font-display text-xl leading-snug font-semibold text-balance sm:text-2xl">
          {result.answer.summary}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{result.answer.explanation}</p>
      </section>

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

      <section className="surface-card p-5">
        <PerformanceChart
          data={result.chart_data}
          average={result.statistics.average}
          hasCompare={Boolean(result.compare_matches)}
        />
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Partidas analisadas</h2>
        <MatchesTable matches={result.matches} metricLabel={result.intent.metric_label} onExport={exportCsv} />
      </section>

      <section className="surface-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-lime" /> O que os dados mostram
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {result.insights.map((insight) => (
            <li key={insight} className="rounded-lg bg-secondary/50 p-3 text-sm">
              {insight}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Observações estatísticas sobre o período analisado. Não representam previsão de eventos futuros.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Perguntas relacionadas
        </h2>
        <div className="flex flex-wrap gap-2">
          {result.related.map((relatedQuestion) => (
            <button
              key={relatedQuestion}
              onClick={() => ask(relatedQuestion)}
              className="rounded-full border border-border bg-card px-3.5 py-2 text-xs transition-colors hover:border-primary/50 hover:text-primary"
            >
              {relatedQuestion}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Confiança nos dados</h2>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <span>Jogos analisados: {result.statistics.sample_size}</span>
          <span>Mando de campo: {result.intent.venue === "all" ? "todos" : result.intent.venue === "home" ? "casa" : "fora"}</span>
          <span>Competição: {competitionLabel ?? "todas"}</span>
          <span>Dados ausentes: {result.source.missing}</span>
        </div>
        <SourceBadge provider={result.source.provider} updatedAt={result.source.updated_at} />
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
            <Button variant="outline" className="w-full" onClick={copyShareLink}>
              Copiar link
            </Button>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Adicionar a um workspace</p>
              {workspaces.map((workspace) => (
                <Button
                  key={workspace.id}
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    addToWorkspace(workspace.id, result);
                    setShareOpen(false);
                    toast.success(`Análise adicionada a ${workspace.name}.`);
                  }}
                >
                  {workspace.name}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

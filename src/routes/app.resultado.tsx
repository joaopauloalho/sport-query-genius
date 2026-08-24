import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Calendar, Download, RefreshCw, Sparkles, Target, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { UniversalResultView } from "@/components/analysis/universal-result-view";
import { MatchesTable } from "@/components/scoutly/matches-table";
import { MetricCard } from "@/components/scoutly/metric-card";
import { PerformanceChart } from "@/components/scoutly/performance-chart";
import { SmartSearch } from "@/components/scoutly/smart-search";
import {
  DemoBadge,
  MethodologyNote,
  RealDataBadge,
  SourceBadge,
} from "@/components/scoutly/source-badge";
import { EmptyState, ProcessingSteps } from "@/components/scoutly/states";
import { Button } from "@/components/ui/button";
import { getCompetition } from "@/data/sports";
import {
  isHeadToHeadAnalysisResult,
  isMatchListAnalysisResult,
  isPlayerEventListAnalysisResult,
  isTeamEventListAnalysisResult,
  toCsv,
  type AnalysisResult,
} from "@/lib/analysis-result";
import {
  SUPPORTED_MATCH_COUNTS,
  type AnalysisOverrides,
  type AnalysisVenue,
  type SupportedMatchCount,
} from "@/lib/analysis-request";
import { analyzeQuestion } from "@/lib/analysis.functions";
import { useScoutly } from "@/lib/store";
import type { UniversalAnalysisResult } from "@/lib/universal-analysis";

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
    const invalidMatchCount =
      rawMatchCount !== undefined &&
      rawMatchCount !== null &&
      rawMatchCount !== "" &&
      !match_count;

    return {
      q: String(search.q ?? ""),
      ...(match_count !== undefined ? { match_count } : {}),
      ...(competition !== undefined ? { competition } : {}),
      ...(venue !== undefined ? { venue } : {}),
      ...(invalidMatchCount ? { invalid_match_count: true as const } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Resultado da análise — Scoutly AI" },
      {
        name: "description",
        content:
          "Resposta, números, eventos, gráfico, tabela e fonte da sua análise real de futebol.",
      },
      { property: "og:title", content: "Resultado da análise — Scoutly AI" },
      {
        property: "og:description",
        content: "Análise de futebol calculada sobre dados estruturados.",
      },
    ],
  }),
  component: ResultPage,
});

const ERROR_TITLES: Record<string, string> = {
  TEAM_NOT_FOUND: "Time não encontrado",
  PLAYER_NOT_FOUND: "Jogador não encontrado",
  ENTITY_AMBIGUOUS: "Entidade ambígua",
  QUESTION_NOT_UNDERSTOOD: "Pergunta não compreendida",
  UNSUPPORTED_METRIC: "Métrica não suportada",
  UNSUPPORTED_FILTER: "Filtro não suportado",
  UNSUPPORTED_CAPABILITY: "Consulta ainda não suportada",
  API_LIMIT_REACHED: "Limite do provider atingido",
  PROVIDER_UNAVAILABLE: "Provider indisponível",
  DATA_INSUFFICIENT: "Dados insuficientes",
  DEEPSEEK_ERROR: "DeepSeek indisponível",
  INVALID_DEEPSEEK_OUTPUT: "Resposta inválida do DeepSeek",
  UNAUTHORIZED: "Sessão expirada",
  RATE_LIMITED: "Muitas solicitações",
  QUOTA_EXCEEDED: "Limite de uso atingido",
  ANALYSIS_IN_PROGRESS: "Análise já em andamento",
  DUPLICATE_REQUEST: "Solicitação já processada",
  USAGE_GUARD_UNAVAILABLE: "Proteção de uso indisponível",
};

type EntityCandidate = {
  id: string;
  name: string;
  provider: string;
  context?: string;
};

type ResultError = {
  code?: string;
  reason: string;
  candidates?: EntityCandidate[];
};

function ResultPage() {
  const { q, match_count, competition, venue, invalid_match_count } = Route.useSearch();
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeQuestion);
  const { refreshUserData, toggleSaved, isSaved } = useScoutly();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<ResultError | null>(null);

  const requestOverrides = useMemo<AnalysisOverrides | undefined>(() => {
    const overrides: AnalysisOverrides = {};
    if (match_count !== undefined) overrides.match_count = match_count;
    if (competition !== undefined)
      overrides.competition = competition === "all" ? null : competition;
    if (venue !== undefined) overrides.venue = venue;
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }, [match_count, competition, venue]);

  const idempotencyKey = useMemo(
    () => crypto.randomUUID(),
    [q, match_count, competition, venue, invalid_match_count],
  );

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
        reason: "Período não suportado. Use exatamente 1, 3, 5, 10, 15 ou 20 partidas.",
      });
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    void analyze({
      data: {
        question: q,
        idempotency_key: idempotencyKey,
        ...(requestOverrides ? { overrides: requestOverrides } : {}),
      },
    })
      .then((outcome) => {
        if (!alive) return;
        if (outcome.ok) {
          setResult(outcome.result);
          void refreshUserData().catch(() => undefined);
          return;
        }

        if (outcome.code === "UNAUTHORIZED") {
          toast.error("Sua sessão expirou. Entre novamente para continuar.");
          void navigate({ to: "/login", replace: true });
          return;
        }

        setError({
          code: outcome.code,
          reason: outcome.reason,
          ...(outcome.candidates ? { candidates: outcome.candidates } : {}),
        });
      })
      .catch(() => {
        if (!alive) return;
        setError({
          reason:
            "Não foi possível concluir a análise agora. Nenhuma estatística foi estimada ou substituída por mock.",
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [
    q,
    invalid_match_count,
    requestOverrides,
    idempotencyKey,
    analyze,
    refreshUserData,
    navigate,
  ]);

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
        <SmartSearch
          defaultValue={q}
          showFilters={false}
          size="sm"
          onSubmit={(question) => ask(question)}
        />
        <EmptyState
          title={
            error?.code
              ? (ERROR_TITLES[error.code] ?? "Não foi possível analisar")
              : "Não foi possível analisar"
          }
          description={error?.reason ?? "Tente reformular a pergunta."}
        />
        {error?.candidates && error.candidates.length > 0 && (
          <section className="surface-card p-5">
            <h2 className="text-sm font-semibold">Qual entidade você quis dizer?</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {error.candidates.map((candidate) => (
                <span
                  key={`${candidate.provider}-${candidate.id}`}
                  className="rounded-full border border-border bg-secondary/40 px-3 py-2 text-xs"
                >
                  {candidate.name}
                  {candidate.context ? ` · ${candidate.context}` : ""}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Refaça a pergunta usando o nome completo de uma das opções acima.
            </p>
          </section>
        )}
      </div>
    );
  }

  function exportCsv() {
    if (!result) return;
    const blob = new Blob([toCsv(result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `scoutly-${result.cache_key.replace(/\|/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado.");
  }

  const competitionLabel =
    getCompetition(result.intent.competition)?.name ?? result.intent.competition ?? null;

  if (
    isTeamEventListAnalysisResult(result) ||
    isMatchListAnalysisResult(result) ||
    isHeadToHeadAnalysisResult(result)
  ) {
    return (
      <UniversalResultView
        q={q}
        result={result as UniversalAnalysisResult}
        saved={isSaved(result.cache_key)}
        onExport={exportCsv}
        onRefresh={() => ask(q, requestOverrides)}
        onAsk={(question) => ask(question)}
        onToggleSaved={() => toggleSaved(result)}
      />
    );
  }

  if (isPlayerEventListAnalysisResult(result)) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <SmartSearch
          defaultValue={q}
          showFilters={false}
          size="sm"
          onSubmit={(question) => ask(question)}
        />

        <header className="surface-card p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-balance sm:text-xl">{result.question}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Target className="size-3.5" />
                  {result.player.name}
                  {result.player.team_name ? ` · ${result.player.team_name}` : ""}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> {result.events.length} gols comprovados
                </span>
                <span>
                  Consulta em{" "}
                  {new Date(result.created_at).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
            </div>
            <RealDataBadge className="shrink-0" />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}>
              <Download className="size-4" /> Exportar CSV
            </Button>
            <Button
              size="sm"
              variant={isSaved(result.cache_key) ? "secondary" : "outline"}
              className="gap-1.5"
              onClick={() => {
                const wasSaved = isSaved(result.cache_key);
                void toggleSaved(result)
                  .then(() =>
                    toast.success(
                      wasSaved ? "Análise removida dos salvos." : "Análise salva na sua conta.",
                    ),
                  )
                  .catch(() => toast.error("Não foi possível atualizar as análises salvas."));
              }}
            >
              <Bookmark className="size-4" />
              {isSaved(result.cache_key) ? "Salva" : "Salvar análise"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => ask(q, requestOverrides)}
            >
              <RefreshCw className="size-4" /> Atualizar dados
            </Button>
          </div>
        </header>

        <section className="surface-card border-primary/30 bg-primary/5 p-6">
          <p className="font-display text-xl leading-snug font-semibold text-balance sm:text-2xl">
            Últimos {result.events.length} gols de {result.player.name}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Eventos individualizados retornados pela {result.source.provider}. A lista não
            representa os últimos {result.events.length} jogos; cada gol conta como um evento
            próprio.
          </p>
        </section>

        <section className="surface-card p-5">
          <h2 className="mb-4 text-sm font-semibold">Gols mais recentes</h2>
          <div className="space-y-3">
            {result.events.map((event, index) => (
              <article
                key={event.event_key}
                className="grid gap-3 rounded-xl border border-border bg-secondary/20 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">
                    {event.opponent} · {new Date(event.date).toLocaleDateString("pt-BR")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.competition} · {event.venue === "home" ? "Casa" : "Fora"}
                    {event.result ? ` · ${event.result}` : ""}
                  </p>
                  {(event.situation || event.body_part || event.xg !== null) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        event.situation,
                        event.body_part,
                        event.xg !== null ? `xG ${event.xg}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-semibold">
                    {event.minute === null
                      ? "Minuto não informado"
                      : `${event.minute}${event.extra_time ? `+${event.extra_time}` : ""}'`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gol #{result.events.length - index}
                  </p>
                </div>
              </article>
            ))}
          </div>
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
            <span>Eventos individualizados: {result.events.length}</span>
            <span>Competição: {competitionLabel ?? "todas"}</span>
            <span>Minutos ausentes: {result.source.missing}</span>
            <span>Jogador: {result.player.name}</span>
          </div>
          <SourceBadge provider={result.source.provider} updatedAt={result.source.updated_at} />
          <MethodologyNote />
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <SmartSearch
        defaultValue={q}
        showFilters={false}
        size="sm"
        onSubmit={(question) => ask(question)}
      />

      <header className="surface-card p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-balance sm:text-xl">{result.question}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Trophy className="size-3.5" />
                Futebol{competitionLabel ? ` · ${competitionLabel}` : ""}
                {result.player?.team_name ? ` · ${result.player.team_name}` : ""}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                {result.statistics.sample_size} partidas analisadas
                {result.intent.venue !== "all" &&
                  (result.intent.venue === "home" ? " · em casa" : " · fora de casa")}
              </span>
              <span>
                Consulta em{" "}
                {new Date(result.created_at).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </div>
          </div>
          {result.demo ? (
            <DemoBadge className="shrink-0" />
          ) : (
            <RealDataBadge className="shrink-0" />
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}>
            <Download className="size-4" /> Exportar CSV
          </Button>
          <Button
            size="sm"
            variant={isSaved(result.cache_key) ? "secondary" : "outline"}
            className="gap-1.5"
            onClick={() => {
              const wasSaved = isSaved(result.cache_key);
              void toggleSaved(result)
                .then(() =>
                  toast.success(
                    wasSaved ? "Análise removida dos salvos." : "Análise salva na sua conta.",
                  ),
                )
                .catch(() => toast.error("Não foi possível atualizar as análises salvas."));
            }}
          >
            <Bookmark className="size-4" />
            {isSaved(result.cache_key) ? "Salva" : "Salvar análise"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => ask(q, requestOverrides)}
          >
            <RefreshCw className="size-4" /> Atualizar dados
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
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Números principais
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Média" value={result.statistics.average} emphasis />
          <MetricCard label="Mediana" value={result.statistics.median} />
          <MetricCard label="Total" value={result.statistics.total} />
          <MetricCard label="Maior valor" value={result.statistics.maximum} />
          <MetricCard label="Menor valor" value={result.statistics.minimum} />
          <MetricCard label="Jogos analisados" value={result.statistics.sample_size} />
          <MetricCard
            label="Tendência recente"
            value={
              result.statistics.trend > 0 ? `+${result.statistics.trend}` : result.statistics.trend
            }
            trend={result.statistics.trend}
            hint="Últimos 5 jogos vs. período"
          />
          <MetricCard
            label="Unidade"
            value={result.answer.unit.split(" ")[0]}
            hint={result.intent.metric_label}
          />
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
        <MatchesTable
          matches={result.matches}
          metricLabel={result.intent.metric_label}
          onExport={exportCsv}
        />
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
          Observações estatísticas sobre o período analisado. Não representam previsão de eventos
          futuros.
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
          <span>
            Mando de campo:{" "}
            {result.intent.venue === "all"
              ? "todos"
              : result.intent.venue === "home"
                ? "casa"
                : "fora"}
          </span>
          <span>Competição: {competitionLabel ?? "todas"}</span>
          <span>Dados ausentes: {result.source.missing}</span>
        </div>
        <SourceBadge provider={result.source.provider} updatedAt={result.source.updated_at} />
        <MethodologyNote />
      </section>
    </div>
  );
}

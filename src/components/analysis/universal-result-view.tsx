import {
  ArrowRightLeft,
  Bookmark,
  Calendar,
  Download,
  RefreshCw,
  ShieldAlert,
  Target,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import { SmartSearch } from "@/components/scoutly/smart-search";
import { MethodologyNote, RealDataBadge, SourceBadge } from "@/components/scoutly/source-badge";
import { Button } from "@/components/ui/button";
import type {
  HeadToHeadAnalysisResult,
  MatchListAnalysisResult,
  TeamEventListAnalysisResult,
  UniversalAnalysisResult,
  UniversalEventType,
} from "@/lib/universal-analysis";

const EVENT_LABELS: Record<UniversalEventType, { singular: string; plural: string }> = {
  goal: { singular: "Gol", plural: "Gols" },
  assist: { singular: "Assistência", plural: "Assistências" },
  yellow_card: { singular: "Cartão amarelo", plural: "Cartões amarelos" },
  red_card: { singular: "Cartão vermelho", plural: "Cartões vermelhos" },
  substitution: { singular: "Substituição", plural: "Substituições" },
  var: { singular: "VAR", plural: "Eventos de VAR" },
  penalty: { singular: "Pênalti", plural: "Pênaltis" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function EventList({ result }: { result: TeamEventListAnalysisResult }) {
  const labels = EVENT_LABELS[result.intent.event_type];
  return (
    <>
      <section className="surface-card border-primary/30 bg-primary/5 p-6">
        <p className="font-display text-xl leading-snug font-semibold text-balance sm:text-2xl">
          {result.events.length} {result.events.length === 1 ? labels.singular : labels.plural}{" "}
          comprovados
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Cada item abaixo é um evento individual retornado pela fonte. Eventos distintos na mesma
          partida continuam separados; dados opcionais ausentes não são convertidos em zero.
        </p>
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Linha do tempo</h2>
        {result.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum evento desse tipo foi encontrado na amostra.
          </p>
        ) : (
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
                    {event.player_name ?? labels.singular}
                    {event.secondary_player_name
                      ? event.event_type === "substitution"
                        ? ` · saiu ${event.secondary_player_name}`
                        : ` · ${event.event_type === "assist" ? "gol de" : "assistência"} ${event.secondary_player_name}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.opponent} · {formatDate(event.date)} · {event.competition} ·{" "}
                    {event.venue === "home" ? "Casa" : "Fora"} · {event.result}
                  </p>
                  {(event.detail || event.situation || event.body_part || event.xg !== null) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        event.detail,
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
                  <p className="mt-1 text-xs text-muted-foreground">{event.source}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function MatchList({ result }: { result: MatchListAnalysisResult }) {
  const upcoming = result.intent.status === "upcoming";
  return (
    <>
      <section className="surface-card border-primary/30 bg-primary/5 p-6">
        <p className="font-display text-xl leading-snug font-semibold text-balance sm:text-2xl">
          {upcoming ? "Próximas partidas" : "Partidas recentes"} de {result.team.name}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {result.matches.length} partida{result.matches.length === 1 ? "" : "s"} na janela
          solicitada.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {result.matches.map((match) => (
          <article key={match.fixture_id} className="surface-card p-5">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{formatDate(match.date)}</span>
              <span>{match.competition}</span>
            </div>
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <p className="text-right text-sm font-medium">{match.home_team.name}</p>
              <div className="rounded-lg bg-secondary px-3 py-2 font-display text-lg font-semibold">
                {upcoming ? "×" : match.result}
              </div>
              <p className="text-sm font-medium">{match.away_team.name}</p>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {match.venue === "home" ? "Casa" : "Fora"}
              {match.outcome ? ` · ${match.outcome}` : ""} · {match.source}
            </p>
          </article>
        ))}
      </section>
    </>
  );
}

function H2H({ result }: { result: HeadToHeadAnalysisResult }) {
  const value = result.summary.requested_value;
  return (
    <>
      <section className="surface-card border-primary/30 bg-primary/5 p-6">
        <div className="flex items-center gap-2 text-sm text-primary">
          <ArrowRightLeft className="size-4" /> Confronto direto
        </div>
        <p className="mt-3 font-display text-xl leading-snug font-semibold text-balance sm:text-2xl">
          {result.teams.primary.name} × {result.teams.compare.name}
        </p>
        {result.summary.requested_metric && (
          <p className="mt-3 text-sm text-muted-foreground">
            {result.summary.requested_metric} · {result.summary.requested_aggregation ?? "total"}:{" "}
            {value ?? "dados insuficientes"}
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="surface-card p-4">
          <p className="text-xs text-muted-foreground">Vitórias {result.teams.primary.name}</p>
          <p className="mt-2 font-display text-2xl font-semibold">{result.summary.team_a_wins}</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-muted-foreground">Empates</p>
          <p className="mt-2 font-display text-2xl font-semibold">{result.summary.draws}</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-muted-foreground">Vitórias {result.teams.compare.name}</p>
          <p className="mt-2 font-display text-2xl font-semibold">{result.summary.team_b_wins}</p>
        </div>
        <div className="surface-card p-4">
          <p className="text-xs text-muted-foreground">Média total de gols</p>
          <p className="mt-2 font-display text-2xl font-semibold">
            {result.summary.average_total_goals ?? "—"}
          </p>
        </div>
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Últimos confrontos</h2>
        <div className="space-y-2">
          {result.meetings.map((match) => (
            <div
              key={match.fixture_id}
              className="grid gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-sm sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="text-xs text-muted-foreground">{formatDate(match.date)}</span>
              <span>
                {match.home_team.name} × {match.away_team.name}
              </span>
              <span className="font-semibold">{match.result}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function UniversalResultView({
  q,
  result,
  saved,
  onToggleSaved,
  onRefresh,
  onExport,
  onAsk,
}: {
  q: string;
  result: UniversalAnalysisResult;
  saved: boolean;
  onToggleSaved: () => Promise<void>;
  onRefresh: () => void;
  onExport: () => void;
  onAsk: (question: string) => void;
}) {
  const titleEntity =
    result.result_type === "head_to_head"
      ? `${result.teams.primary.name} × ${result.teams.compare.name}`
      : result.team.name;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <SmartSearch
        defaultValue={q}
        showFilters={false}
        size="sm"
        onSubmit={(question) => onAsk(question)}
      />

      <header className="surface-card p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-balance sm:text-xl">{result.question}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                {result.result_type === "head_to_head" ? (
                  <Trophy className="size-3.5" />
                ) : result.result_type === "event_list" ? (
                  <Target className="size-3.5" />
                ) : (
                  <Calendar className="size-3.5" />
                )}
                {titleEntity}
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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onExport}>
            <Download className="size-4" /> Exportar CSV
          </Button>
          <Button
            size="sm"
            variant={saved ? "secondary" : "outline"}
            className="gap-1.5"
            onClick={() => {
              void onToggleSaved()
                .then(() =>
                  toast.success(
                    saved ? "Análise removida dos salvos." : "Análise salva na sua conta.",
                  ),
                )
                .catch(() => toast.error("Não foi possível atualizar as análises salvas."));
            }}
          >
            <Bookmark className="size-4" /> {saved ? "Salva" : "Salvar análise"}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={onRefresh}>
            <RefreshCw className="size-4" /> Atualizar dados
          </Button>
        </div>
      </header>

      {result.result_type === "event_list" ? (
        <EventList result={result} />
      ) : result.result_type === "match_list" ? (
        <MatchList result={result} />
      ) : (
        <H2H result={result} />
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Perguntas relacionadas
        </h2>
        <div className="flex flex-wrap gap-2">
          {result.related.map((question) => (
            <button
              key={question}
              onClick={() => onAsk(question)}
              className="rounded-full border border-border bg-card px-3.5 py-2 text-xs transition-colors hover:border-primary/50 hover:text-primary"
            >
              {question}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-card space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="size-4 text-primary" /> Cobertura e proveniência
        </h2>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <span>Amostra: {result.provenance.sample_size}</span>
          <span>Valores/eventos incompletos: {result.provenance.missing_values}</span>
          <span>Família: {result.provenance.data_family}</span>
          <span>Cache: {result.provenance.cache_status}</span>
          <span className="sm:col-span-2 break-all">
            Fonte técnica: {result.provenance.source_endpoint}
          </span>
        </div>
        <SourceBadge provider={result.source.provider} updatedAt={result.source.updated_at} />
        <MethodologyNote />
      </section>
    </div>
  );
}

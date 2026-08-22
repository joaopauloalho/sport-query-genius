import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bookmark, Clock, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isEventListAnalysisResult } from "@/lib/analysis";
import { useScoutly } from "@/lib/store";

export const Route = createFileRoute("/app/historico")({
  head: () => ({ meta: [{ title: "Histórico — Scoutly AI" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const navigate = useNavigate();
  const { history, loadingUserData, clearHistory, toggleSaved, isSaved } = useScoutly();

  if (loadingUserData) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Carregando histórico…
        </span>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Clock className="size-5 text-primary" /> Histórico
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Análises sincronizadas com sua conta, inclusive em outro navegador.
          </p>
        </div>
        {history.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void clearHistory().then(() => toast.success("Histórico limpo."))}
          >
            <Trash2 className="size-4" /> Limpar histórico
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="surface-card mt-8 p-8 text-center text-sm text-muted-foreground">
          Suas próximas análises aparecerão aqui.
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {history.map((entry) => {
            const result = entry.result;
            const eventList = isEventListAnalysisResult(result);
            return (
              <article key={entry.id} className="surface-card p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{entry.question}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString("pt-BR")} ·{" "}
                      {eventList
                        ? `${result.events.length} gols comprovados`
                        : `${result.statistics.sample_size} jogos · resultado ${result.answer.value}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void toggleSaved(result).then(() =>
                          toast.success(
                            isSaved(entry.cacheKey) ? "Removida dos salvos." : "Análise salva.",
                          ),
                        )
                      }
                    >
                      <Bookmark className="mr-1.5 size-4" />{" "}
                      {isSaved(entry.cacheKey) ? "Salva" : "Salvar"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        void navigate({ to: "/app/resultado", search: { q: entry.question } })
                      }
                    >
                      Reabrir
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

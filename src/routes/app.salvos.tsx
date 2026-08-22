import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bookmark, FolderPlus, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isEventListAnalysisResult } from "@/lib/analysis";
import { useScoutly } from "@/lib/store";

export const Route = createFileRoute("/app/salvos")({
  head: () => ({ meta: [{ title: "Salvos — Scoutly AI" }] }),
  component: SavedPage,
});

function SavedPage() {
  const navigate = useNavigate();
  const { saved, workspaces, loadingUserData, toggleSaved, addToWorkspace } = useScoutly();
  const [workspaceByAnalysis, setWorkspaceByAnalysis] = useState<Record<string, string>>({});

  if (loadingUserData) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Carregando análises salvas…
        </span>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bookmark className="size-5 text-primary" /> Análises salvas
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Snapshots persistidos na sua conta, independentes do histórico local do navegador.
        </p>
      </div>

      {saved.length === 0 ? (
        <div className="surface-card mt-8 p-8 text-center text-sm text-muted-foreground">
          Salve uma análise pelo histórico para encontrá-la aqui.
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {saved.map((analysis) => {
            const selectedWorkspace =
              workspaceByAnalysis[analysis.cache_key] ?? workspaces[0]?.id ?? "";
            const eventList = isEventListAnalysisResult(analysis);
            return (
              <article key={analysis.cache_key} className="surface-card p-4 sm:p-5">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{analysis.question}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {eventList
                          ? `${analysis.events.length} gols · ${analysis.player.name}`
                          : `${analysis.statistics.sample_size} jogos · ${analysis.intent.metric_label} · ${analysis.answer.value} ${analysis.answer.unit}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          void navigate({ to: "/app/resultado", search: { q: analysis.question } })
                        }
                      >
                        Reabrir
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void toggleSaved(analysis).then(() =>
                            toast.success("Análise removida dos salvos."),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  {workspaces.length > 0 && (
                    <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                      <select
                        value={selectedWorkspace}
                        onChange={(event) =>
                          setWorkspaceByAnalysis((current) => ({
                            ...current,
                            [analysis.cache_key]: event.target.value,
                          }))
                        }
                        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
                      >
                        {workspaces.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() =>
                          void addToWorkspace(selectedWorkspace, analysis).then(() =>
                            toast.success("Análise adicionada ao workspace."),
                          )
                        }
                      >
                        <FolderPlus className="size-4" /> Adicionar ao workspace
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

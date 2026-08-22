import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderKanban, Loader2, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useScoutly } from "@/lib/store";

export const Route = createFileRoute("/app/workspaces")({
  head: () => ({ meta: [{ title: "Workspaces — Scoutly AI" }] }),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const navigate = useNavigate();
  const { workspaces, workspaceItems, loadingUserData, createWorkspace, removeFromWorkspace } =
    useScoutly();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createWorkspace(name, description);
      setName("");
      setDescription("");
      toast.success("Workspace criado.");
    } finally {
      setCreating(false);
    }
  }

  if (loadingUserData) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Carregando workspaces…
        </span>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FolderKanban className="size-5 text-primary" /> Workspaces
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Organize análises persistidas. Cada workspace pertence somente à sua conta.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="surface-card mt-7 grid gap-3 p-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end"
      >
        <label className="text-sm font-medium">
          Nome
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            placeholder="Ex.: Corinthians semanal"
          />
        </label>
        <label className="text-sm font-medium">
          Descrição
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            placeholder="Opcional"
          />
        </label>
        <Button type="submit" disabled={creating || !name.trim()} className="gap-1.5">
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{" "}
          Criar
        </Button>
      </form>

      {workspaces.length === 0 ? (
        <div className="surface-card mt-8 p-8 text-center text-sm text-muted-foreground">
          Crie seu primeiro workspace acima. Depois, adicione análises pela área de Salvos.
        </div>
      ) : (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {workspaces.map((workspace) => {
            const items = workspaceItems[workspace.id] ?? [];
            return (
              <section key={workspace.id} className="surface-card p-5">
                <div>
                  <h2 className="font-semibold">{workspace.name}</h2>
                  {workspace.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{workspace.description}</p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">{items.length} análise(s)</p>
                </div>
                {items.length === 0 ? (
                  <p className="mt-5 rounded-lg bg-secondary/40 p-3 text-xs text-muted-foreground">
                    Ainda não há análises neste workspace.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {items.map((analysis) => (
                      <li
                        key={analysis.cache_key}
                        className="flex items-center gap-2 rounded-lg border border-border p-2.5"
                      >
                        <button
                          className="min-w-0 flex-1 text-left text-sm hover:text-primary"
                          onClick={() =>
                            void navigate({
                              to: "/app/resultado",
                              search: { q: analysis.question },
                            })
                          }
                        >
                          <span className="block truncate">{analysis.question}</span>
                        </button>
                        <button
                          aria-label="Remover do workspace"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          onClick={() =>
                            void removeFromWorkspace(workspace.id, analysis.cache_key).then(() =>
                              toast.success("Análise removida do workspace."),
                            )
                          }
                        >
                          <X className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

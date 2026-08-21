import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Users } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/jogadores")({
  head: () => ({
    meta: [
      { title: "Jogadores — Em breve — Scoutly AI" },
      {
        name: "description",
        content:
          "Análises e comparações de jogadores ainda não possuem backend real e estão temporariamente indisponíveis.",
      },
    ],
  }),
  component: PlayersPage,
});

function PlayersPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <section className="surface-card p-6 sm:p-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
          <Users className="size-3.5" /> Em breve
        </span>
        <h1 className="mt-5 text-2xl font-bold">Jogadores</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Perfis, estatísticas e comparações de jogadores ainda não têm backend real. Esta área foi
          desativada para não exibir números gerados ou demonstrativos como se fossem dados dos
          providers.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Nesta fase, o produto suporta somente análises de equipes de futebol.
        </p>
        <Button className="mt-6 gap-2" asChild>
          <Link to="/app">
            Analisar uma equipe
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>
    </div>
  );
}

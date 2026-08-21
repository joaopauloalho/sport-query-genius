import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/jogos")({
  head: () => ({
    meta: [
      { title: "Jogos — Em breve — Scoutly AI" },
      {
        name: "description",
        content: "A listagem de jogos está temporariamente indisponível até ser conectada aos providers reais.",
      },
    ],
  }),
  component: MatchesPage,
});

function MatchesPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <section className="surface-card p-6 sm:p-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
          <CalendarClock className="size-3.5" /> Em breve
        </span>
        <h1 className="mt-5 text-2xl font-bold">Jogos</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A lista de partidas desta tela ainda era alimentada por fixtures demonstrativas. Ela foi desativada até existir uma integração real adequada para navegação por jogos.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Você já pode analisar partidas qualificadas de uma equipe por meio das consultas reais de período, competição e mando.
        </p>
        <Button className="mt-6 gap-2" asChild>
          <Link to="/app">
            Fazer uma análise real
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>
    </div>
  );
}

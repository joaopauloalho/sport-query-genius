import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/explorar")({
  head: () => ({
    meta: [
      { title: "Explorar — Em breve — Scoutly AI" },
      {
        name: "description",
        content:
          "A área Explorar está temporariamente indisponível até usar somente dados reais dos providers.",
      },
    ],
  }),
  component: Explore,
});

function Explore() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <section className="surface-card p-6 sm:p-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
          <Compass className="size-3.5" /> Em breve
        </span>
        <h1 className="mt-5 text-2xl font-bold">Explorar</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Esta tela ainda dependia de tendências, comparações e listas demonstrativas, incluindo
          recursos que o backend atual não suporta. Ela foi desativada temporariamente para não
          misturar dados reais com conteúdo simulado.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Hoje, a funcionalidade disponível é a análise de equipes de futebol por pergunta, com
          filtros reais de período, competição e mando.
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

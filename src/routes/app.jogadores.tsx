import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/jogadores")({
  head: () => ({
    meta: [
      { title: "Jogadores — Scoutly AI" },
      {
        name: "description",
        content: "Análises reais de jogadores de futebol disponíveis pela Smart Search.",
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
          <Users className="size-3.5" /> Smart Search ativa
        </span>
        <h1 className="mt-5 text-2xl font-bold">Jogadores</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A análise real de jogadores de futebol já está disponível pela Smart Search. O sistema
          resolve o atleta no provider e calcula agregações sobre partidas com participação
          registrada, sem preencher estatísticas ausentes com mocks.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Nesta fase ainda não existe um catálogo completo de jogadores. Pesquise diretamente pelo
          nome e pela estatística desejada.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button className="gap-2" asChild>
            <Link
              to="/app/resultado"
              search={{
                q: "Qual foi a média de finalizações do Yuri Alberto nos últimos 5 jogos?",
              }}
            >
              <Search className="size-4" /> Analisar Yuri Alberto
            </Link>
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <Link
              to="/app/resultado"
              search={{ q: "Quais foram os últimos 5 gols do Yuri Alberto?" }}
            >
              Ver últimos gols <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

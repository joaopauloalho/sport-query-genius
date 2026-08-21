import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/equipes")({
  head: () => ({
    meta: [
      { title: "Equipes — Em breve — Scoutly AI" },
      {
        name: "description",
        content: "Perfis navegáveis de equipes estão temporariamente indisponíveis até usarem dados reais dos providers.",
      },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
      <section className="surface-card p-6 sm:p-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
          <Shield className="size-3.5" /> Em breve
        </span>
        <h1 className="mt-5 text-2xl font-bold">Perfis de equipes</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          O perfil agregado desta rota ainda combinava cadastro e métricas demonstrativas. A tela foi desativada para que nenhum número simulado pareça informação real.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A análise real de equipes continua disponível pela busca principal, incluindo período, competição e mando de campo.
        </p>
        <Button className="mt-6 gap-2" asChild>
          <Link to="/app">
            Perguntar sobre uma equipe
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>
    </div>
  );
}

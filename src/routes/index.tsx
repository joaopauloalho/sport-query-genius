import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Check,
  Download,
  Filter,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react";

import { Logo } from "@/components/scoutly/logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scoutly AI — Análise real de equipes de futebol" },
      {
        name: "description",
        content:
          "Faça perguntas em linguagem natural sobre equipes de futebol e receba análises com dados reais, filtros, gráficos, partidas e fontes identificadas.",
      },
      { property: "og:title", content: "Scoutly AI — Análise real de equipes de futebol" },
      {
        property: "og:description",
        content: "Análises de equipes de futebol com dados reais, filtros e fontes identificadas.",
      },
    ],
  }),
  component: Landing,
});

const CAPABILITIES = [
  {
    icon: Sparkles,
    title: "Perguntas em linguagem natural",
    text: "Descreva a equipe e a métrica que quer analisar sem montar consultas técnicas.",
  },
  {
    icon: Filter,
    title: "Filtros reais",
    text: "Use períodos de 5, 10, 15 ou 20 partidas, competição e mando de campo.",
  },
  {
    icon: BarChart3,
    title: "Cálculo determinístico",
    text: "Médias, totais, medianas e tendências são calculados sobre as partidas qualificadas.",
  },
  {
    icon: Table2,
    title: "Partidas visíveis",
    text: "Confira a amostra usada no cálculo em tabela, sem esconder quais jogos entraram na análise.",
  },
  {
    icon: ShieldCheck,
    title: "Fonte e atualização",
    text: "O resultado identifica o provider utilizado e a última atualização dos dados.",
  },
  {
    icon: Download,
    title: "Exportação CSV",
    text: "Exporte a análise atual para continuar o trabalho em planilhas ou relatórios.",
  },
];

const FLOW = [
  "A pergunta é interpretada no servidor.",
  "Os filtros explícitos da interface prevalecem sobre a inferência.",
  "BSD é usado como provider principal quando configurado, com fallback controlado para API-Football.",
  "O backend calcula o resultado e devolve amostra, gráfico, tabela, fonte e eventuais erros sem preencher lacunas com mock.",
];

const LIMITATIONS = [
  "O backend real atual cobre análises de equipes de futebol.",
  "Jogadores, tênis e basquete ainda não estão disponíveis.",
  "Explorar, perfis navegáveis de equipes e listagem de jogos aguardam integrações reais próprias.",
  "Cobrança, pagamentos e planos pagos ainda não foram implementados.",
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#funciona" className="transition-colors hover:text-foreground">
              Funciona hoje
            </a>
            <a href="#como-funciona" className="transition-colors hover:text-foreground">
              Como funciona
            </a>
            <a href="#limites" className="transition-colors hover:text-foreground">
              Limites atuais
            </a>
          </nav>
          <Button size="sm" asChild>
            <Link to="/app">Abrir análise</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="hero-glow relative overflow-hidden px-4 pt-20 pb-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-lime/40 bg-lime/10 px-3 py-1 text-xs font-semibold tracking-wide text-lime uppercase">
              <ShieldCheck className="size-3.5" /> Dados reais · futebol
            </span>
            <h1 className="animate-rise mt-6 text-4xl leading-[1.08] font-bold text-balance sm:text-6xl">
              Analise equipes de futebol sem{" "}
              <span className="text-gradient">horas de pesquisa</span>.
            </h1>
            <p className="animate-rise mx-auto mt-5 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">
              Faça uma pergunta, escolha período, competição e mando e receba números calculados
              sobre partidas reais, com fonte e amostra identificadas.
            </p>
            <div className="animate-rise mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" className="gap-2" asChild>
                <Link to="/app">
                  Fazer uma análise
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#funciona">Ver o que funciona</a>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Conta e sincronização em nuvem já estão disponíveis. Cobrança e pagamentos continuam
              fora desta fase.
            </p>
          </div>
        </section>

        <section id="funciona" className="border-t border-border/60 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <h2 className="text-3xl font-bold">O que funciona hoje</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
                A superfície do produto mostra somente capacidades conectadas ao motor real de
                análise.
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((capability) => (
                <div key={capability.title} className="surface-card p-5">
                  <capability.icon className="size-5 text-primary" />
                  <h3 className="mt-4 text-base font-semibold">{capability.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {capability.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="px-4 pb-20 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <Newspaper className="size-7 text-primary" />
              <h2 className="mt-4 text-3xl font-bold">Do texto ao número verificável</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                A inteligência artificial interpreta a intenção. A estatística final não é inventada
                por ela: o cálculo acontece no backend sobre dados estruturados dos providers
                disponíveis.
              </p>
            </div>
            <ol className="surface-card space-y-4 p-6">
              {FLOW.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {index + 1}
                  </span>
                  <span className="pt-0.5 text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="limites" className="border-t border-border/60 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="surface-card border-primary/20 p-6 sm:p-8">
              <h2 className="text-2xl font-bold">Limites atuais, sem esconder o que falta</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Estes recursos ficam fora da experiência principal até possuírem implementação real
                adequada.
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {LIMITATIONS.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-lime" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button className="mt-7 gap-2" asChild>
                <Link to="/app">
                  Abrir o que já funciona
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
          <Logo />
          <p>
            Scoutly AI — análises reais de equipes de futebol com fonte, filtros e amostra
            explícitos.
          </p>
        </div>
      </footer>
    </div>
  );
}

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock,
  FileSpreadsheet,
  LineChart,
  Newspaper,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Table2,
  Users,
} from "lucide-react";

import { Logo } from "@/components/scoutly/logo";
import { MetricCard } from "@/components/scoutly/metric-card";
import { PerformanceChart } from "@/components/scoutly/performance-chart";
import { DemoBadge, MethodologyNote, SourceBadge } from "@/components/scoutly/source-badge";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/data/sports";
import { runAnalysis } from "@/lib/analysis";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scoutly AI — Dados esportivos sem horas de pesquisa" },
      {
        name: "description",
        content:
          "Faça perguntas em linguagem natural e transforme estatísticas esportivas em respostas, gráficos e insights. Para jornalistas, criadores e analistas.",
      },
      { property: "og:title", content: "Scoutly AI — Dados esportivos sem horas de pesquisa" },
      {
        property: "og:description",
        content: "Pergunte qualquer coisa sobre esportes. Encontre em segundos o que levaria horas para pesquisar.",
      },
    ],
  }),
  component: Landing,
});

const DEMO_QUESTION = "Qual foi a média de escanteios do Corinthians nos últimos 20 jogos?";

const PROBLEMS = [
  "Abrir dezenas de partidas uma a uma",
  "Copiar números para uma planilha",
  "Fazer cálculos manuais",
  "Montar gráficos do zero",
  "Comparar telas diferentes",
  "Revisar tudo antes de publicar",
];

const SOLUTIONS = [
  "Uma pergunta em linguagem natural",
  "Parâmetros identificados automaticamente",
  "Cálculo feito no backend sobre dados estruturados",
  "Resposta, números, gráfico e tabela na mesma tela",
  "Período, amostra e fonte sempre visíveis",
  "Análises salvas e organizadas em workspaces",
];

const USE_CASES = [
  { icon: Newspaper, title: "Jornalismo esportivo", text: "Números checáveis para matérias e reportagens com prazo curto." },
  { icon: Sparkles, title: "Produção de conteúdo", text: "Pautas, cortes e roteiros baseados em estatísticas reais." },
  { icon: LineChart, title: "Análise esportiva", text: "Leitura de tendências de desempenho por período e mando de campo." },
  { icon: Users, title: "Pesquisa de jogadores", text: "Perfis, médias recentes e comparações lado a lado." },
  { icon: BarChart3, title: "Acompanhamento de equipes", text: "Forma recente, desempenho em casa e fora, evolução por competição." },
  { icon: FileSpreadsheet, title: "Relatórios e exportação", text: "Tabelas detalhadas prontas para exportar em CSV." },
];

function Landing() {
  const navigate = useNavigate();
  const outcome = runAnalysis(DEMO_QUESTION);
  const demo = outcome.ok ? outcome.result : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#problema" className="transition-colors hover:text-foreground">Problema</a>
            <a href="#solucao" className="transition-colors hover:text-foreground">Solução</a>
            <a href="#casos" className="transition-colors hover:text-foreground">Casos de uso</a>
            <Link to="/precos" className="transition-colors hover:text-foreground">Planos</Link>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/auth">Entrar</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/app">Começar gratuitamente</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="hero-glow relative overflow-hidden px-4 pt-20 pb-16 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <DemoBadge className="animate-fade" />
            <h1 className="animate-rise mt-6 text-4xl leading-[1.08] font-bold text-balance sm:text-6xl">
              Dados esportivos sem <span className="text-gradient">horas de pesquisa</span>.
            </h1>
            <p className="animate-rise mx-auto mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
              Faça perguntas em linguagem natural e transforme estatísticas esportivas em respostas,
              gráficos e insights.
            </p>
            <div className="animate-rise mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" className="gap-2" onClick={() => navigate({ to: "/app" })}>
                Começar gratuitamente
                <ArrowRight className="size-4" />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#demonstracao">Ver demonstração</a>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Pergunte qualquer coisa sobre esportes. Encontre em segundos o que levaria horas para pesquisar.
            </p>
          </div>
        </section>

        {/* Demonstração */}
        <section id="demonstracao" className="px-4 pb-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="surface-card glow-ring overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                <ScanSearch className="size-4 shrink-0 text-primary" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{DEMO_QUESTION}</p>
                <DemoBadge />
              </div>

              {demo && (
                <div className="space-y-6 p-5 sm:p-6">
                  <div>
                    <p className="font-display text-xl font-semibold text-balance sm:text-2xl">
                      {demo.answer.summary}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{demo.answer.explanation}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <MetricCard label="Média" value={demo.statistics.average} emphasis />
                    <MetricCard label="Mediana" value={demo.statistics.median} />
                    <MetricCard label="Máximo" value={demo.statistics.maximum} />
                    <MetricCard label="Jogos" value={demo.statistics.sample_size} />
                  </div>

                  <PerformanceChart data={demo.chart_data} average={demo.statistics.average} height={240} />

                  <ul className="grid gap-2 sm:grid-cols-2">
                    {demo.insights.slice(0, 4).map((i) => (
                      <li key={i} className="flex items-start gap-2 rounded-lg bg-secondary/50 p-3 text-sm">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-lime" />
                        {i}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <SourceBadge />
                    <Button variant="outline" size="sm" className="gap-1.5" asChild>
                      <Link to="/app">
                        <Table2 className="size-4" />
                        Ver análise completa
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <MethodologyNote className="mx-auto mt-4 max-w-2xl justify-center text-center" />
          </div>
        </section>

        {/* Problema / Solução */}
        <section id="problema" className="border-t border-border/60 px-4 py-20 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
            <div className="surface-card p-6">
              <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <Clock className="size-4" /> Hoje você precisa
              </span>
              <ul className="mt-5 space-y-3">
                {PROBLEMS.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive/70" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div id="solucao" className="surface-card border-primary/30 bg-primary/5 p-6">
              <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-primary uppercase">
                <Sparkles className="size-4" /> Com a Scoutly AI
              </span>
              <ul className="mt-5 space-y-3">
                {SOLUTIONS.map((s) => (
                  <li key={s} className="flex items-start gap-3 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-lime" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Casos de uso */}
        <section id="casos" className="px-4 pb-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold">Feito para quem trabalha com esporte</h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-sm text-muted-foreground">
              Criadores de conteúdo, jornalistas, analistas independentes, scouts e equipes de mídia.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((c) => (
                <div key={c.title} className="surface-card p-5 transition-colors hover:border-primary/40">
                  <c.icon className="size-5 text-primary" />
                  <h3 className="mt-4 text-base font-semibold">{c.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{c.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Confiança */}
        <section className="border-t border-border/60 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
              <div>
                <ShieldCheck className="size-7 text-lime" />
                <h2 className="mt-4 text-3xl font-bold">Transparência em cada número</h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  A inteligência artificial interpreta e explica. Os cálculos acontecem no backend, sobre dados
                  estruturados. Nenhuma estatística é inventada.
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  "Dados estruturados por partida",
                  "Fontes sempre identificadas",
                  "Cálculos realizados no backend",
                  "Período e amostra explícitos",
                  "Aviso quando faltam dados",
                  "Nenhuma estatística inventada",
                ].map((i) => (
                  <li key={i} className="surface-card flex items-start gap-2 p-3 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-lime" />
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Planos */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold">Planos</h2>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              Preços provisórios para o MVP.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLANS.map((p) => (
                <div
                  key={p.id}
                  className={`surface-card flex flex-col p-5 ${p.highlight ? "border-primary/50 glow-ring" : ""}`}
                >
                  <h3 className="text-sm font-semibold text-muted-foreground">{p.name}</h3>
                  <p className="mt-2 font-display text-2xl font-bold">{p.price}</p>
                  <p className="text-xs text-muted-foreground">{p.period}</p>
                  <ul className="mt-4 flex-1 space-y-2 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-muted-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-lime" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-5" variant={p.highlight ? "default" : "outline"} asChild>
                    <Link to="/precos">{p.cta}</Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="hero-glow border-t border-border/60 px-4 py-24 text-center sm:px-6">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold text-balance sm:text-4xl">
            Pare de procurar jogo por jogo. Comece a perguntar.
          </h2>
          <Button size="lg" className="mt-8 gap-2" asChild>
            <Link to="/app">
              Começar gratuitamente
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </section>
      </main>

      <footer className="border-t border-border/60 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
          <Logo />
          <p>Scoutly AI — plataforma de análise e pesquisa esportiva. Dados demonstrativos no MVP.</p>
        </div>
      </footer>
    </div>
  );
}

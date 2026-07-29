import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Compass, Flame, GitCompareArrows, LineChart, Trophy, Users } from "lucide-react";
import { useState } from "react";

import { DemoBadge } from "@/components/scoutly/source-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COMPETITIONS, PLAYERS, SPORTS, TEAMS } from "@/data/sports";

export const Route = createFileRoute("/app/explorar")({
  head: () => ({
    meta: [
      { title: "Explorar — Scoutly AI" },
      { name: "description", content: "Descubra tendências, líderes estatísticos e comparações populares sem formular uma pergunta." },
      { property: "og:title", content: "Explorar — Scoutly AI" },
      { property: "og:description", content: "Tendências, líderes e comparações esportivas." },
    ],
  }),
  component: Explore,
});

const CATEGORIES = [
  {
    id: "alta",
    label: "Em alta",
    icon: Flame,
    items: [
      "Escanteios do Corinthians nos últimos 20 jogos",
      "Gols do Real Madrid nos últimos 10 jogos",
      "Aces de Jannik Sinner nos últimos 15 jogos",
    ],
  },
  {
    id: "comparacoes",
    label: "Comparações populares",
    icon: GitCompareArrows,
    items: [
      "Compare Nico Williams e Lamine Yamal em dribles nos últimos 10 jogos",
      "Compare Carlos Alcaraz e Jannik Sinner em winners nos últimos 20 jogos",
      "Compare Liverpool e Manchester City em finalizações nos últimos 15 jogos",
    ],
  },
  {
    id: "recente",
    label: "Desempenho recente",
    icon: LineChart,
    items: [
      "Mostre o desempenho do Flamengo em jogos fora de casa",
      "Média de cartões do Barcelona nos últimos 10 jogos",
      "Finalizações no alvo de Mohamed Salah nos últimos 5 jogos",
    ],
  },
  {
    id: "lideres",
    label: "Líderes estatísticos",
    icon: Trophy,
    items: [
      "Média de gols de Erling Haaland nos últimos 20 jogos",
      "Passes decisivos de Lamine Yamal nos últimos 15 jogos",
      "Média de posse de bola do Manchester City nos últimos 10 jogos",
    ],
  },
  {
    id: "tendencias",
    label: "Tendências",
    icon: Compass,
    items: [
      "Gols sofridos do Corinthians nos últimos 15 jogos",
      "Duplas faltas de Alexander Zverev nos últimos 30 jogos",
      "Finalizações do Real Madrid em casa nos últimos 10 jogos",
    ],
  },
  {
    id: "comunidade",
    label: "Análises da comunidade",
    icon: Users,
    items: [
      "Faltas recebidas de Vinícius Júnior nos últimos 20 jogos",
      "Escanteios do Liverpool fora de casa nos últimos 10 jogos",
      "Média de rebotes em jogos recentes",
    ],
  },
];

function Explore() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ sport: "football", competition: "all", team: "all", player: "all" });

  const ask = (q: string) => navigate({ to: "/app/resultado", search: { q } });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Explorar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Descubra informações sem precisar formular uma pergunta.
          </p>
        </div>
        <DemoBadge className="shrink-0" />
      </div>

      <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={filters.sport} onValueChange={(v) => setFilters({ ...filters, sport: v })}>
          <SelectTrigger aria-label="Esporte"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SPORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.competition} onValueChange={(v) => setFilters({ ...filters, competition: v })}>
          <SelectTrigger aria-label="Competição"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as competições</SelectItem>
            {COMPETITIONS.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.team} onValueChange={(v) => setFilters({ ...filters, team: v })}>
          <SelectTrigger aria-label="Equipe"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as equipes</SelectItem>
            {TEAMS.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.player} onValueChange={(v) => setFilters({ ...filters, player: v })}>
          <SelectTrigger aria-label="Jogador"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os jogadores</SelectItem>
            {PLAYERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="alta" className="mt-8">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          {CATEGORIES.map((c) => (
            <TabsTrigger key={c.id} value={c.id} className="gap-1.5 text-xs">
              <c.icon className="size-3.5" />
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {CATEGORIES.map((c) => (
          <TabsContent key={c.id} value={c.id} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {c.items.map((item) => (
              <button
                key={item}
                onClick={() => ask(item)}
                className="surface-card animate-rise p-4 text-left text-sm transition-colors hover:border-primary/50"
              >
                {item}
              </button>
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

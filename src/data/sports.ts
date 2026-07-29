/**
 * DADOS DEMONSTRATIVOS (mock) — centralizados.
 * Nenhum componente deve conter números "hardcoded".
 * Substituir esta camada por uma API esportiva real no futuro.
 */

export type SportId = "football" | "tennis" | "basketball";

export interface Sport {
  id: SportId;
  name: string;
  metrics: MetricDef[];
}

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  base: number;
  spread: number;
  aliases: string[];
}

export interface Competition {
  id: string;
  name: string;
  country: string;
  sport: SportId;
  season: string;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  country: string;
  competitionId: string;
  colors: [string, string];
  founded: number;
}

export interface Player {
  id: string;
  name: string;
  teamId: string | null;
  sport: SportId;
  position: string;
  nationality: string;
  age: number;
  competitionId: string;
  initials: string;
}

export const DATA_SOURCE = {
  provider: "Provedor demonstrativo",
  updatedAt: "2026-07-29T09:00:00.000Z",
  methodologyNote:
    "Métricas esportivas podem variar conforme a metodologia adotada pelo fornecedor de dados.",
};

export const FOOTBALL_METRICS: MetricDef[] = [
  { key: "corners", label: "Escanteios", unit: "escanteios por partida", base: 5.6, spread: 3.4, aliases: ["escanteio", "escanteios", "corner", "corners"] },
  { key: "goals", label: "Gols marcados", unit: "gols por partida", base: 1.8, spread: 1.6, aliases: ["gol", "gols", "goals"] },
  { key: "goals_conceded", label: "Gols sofridos", unit: "gols sofridos por partida", base: 1.1, spread: 1.3, aliases: ["gols sofridos", "sofridos"] },
  { key: "shots", label: "Finalizações", unit: "finalizações por partida", base: 13.4, spread: 5.5, aliases: ["finalizacao", "finalizações", "finalizacoes", "chutes"] },
  { key: "shots_on_target", label: "Finalizações no alvo", unit: "finalizações no alvo por partida", base: 5.1, spread: 2.8, aliases: ["no alvo", "alvo", "shots on target"] },
  { key: "fouls_drawn", label: "Faltas recebidas", unit: "faltas recebidas por partida", base: 2.4, spread: 2.1, aliases: ["faltas recebidas", "falta recebida", "sofreu falta"] },
  { key: "cards", label: "Cartões", unit: "cartões por partida", base: 2.2, spread: 1.7, aliases: ["cartao", "cartões", "cartoes", "amarelo"] },
  { key: "assists", label: "Assistências", unit: "assistências por partida", base: 0.4, spread: 0.9, aliases: ["assistencia", "assistências", "assistencias"] },
  { key: "dribbles", label: "Dribles certos", unit: "dribles por partida", base: 3.1, spread: 2.4, aliases: ["drible", "dribles"] },
  { key: "key_passes", label: "Passes decisivos", unit: "passes decisivos por partida", base: 2.0, spread: 1.8, aliases: ["passe decisivo", "passes decisivos", "passes importantes"] },
  { key: "possession", label: "Posse de bola", unit: "% de posse", base: 56, spread: 14, aliases: ["posse", "posse de bola"] },
];

export const TENNIS_METRICS: MetricDef[] = [
  { key: "aces", label: "Aces", unit: "aces por partida", base: 9.4, spread: 7.5, aliases: ["ace", "aces"] },
  { key: "double_faults", label: "Duplas faltas", unit: "duplas faltas por partida", base: 2.6, spread: 2.2, aliases: ["dupla falta", "duplas faltas"] },
  { key: "first_serve_pct", label: "1º serviço", unit: "% de 1º serviço", base: 63, spread: 12, aliases: ["primeiro servico", "1o servico", "servico"] },
  { key: "winners", label: "Winners", unit: "winners por partida", base: 28, spread: 14, aliases: ["winner", "winners"] },
  { key: "break_points", label: "Break points convertidos", unit: "break points por partida", base: 3.2, spread: 2.6, aliases: ["break point", "break points", "quebras"] },
];

export const BASKETBALL_METRICS: MetricDef[] = [
  { key: "points", label: "Pontos", unit: "pontos por jogo", base: 21.5, spread: 11, aliases: ["ponto", "pontos"] },
  { key: "rebounds", label: "Rebotes", unit: "rebotes por jogo", base: 6.8, spread: 4.5, aliases: ["rebote", "rebotes"] },
  { key: "three_points", label: "Bolas de 3", unit: "cestas de 3 por jogo", base: 2.6, spread: 2.4, aliases: ["tres pontos", "bola de 3", "3 pontos"] },
];

export const SPORTS: Sport[] = [
  { id: "football", name: "Futebol", metrics: FOOTBALL_METRICS },
  { id: "tennis", name: "Tênis", metrics: TENNIS_METRICS },
  { id: "basketball", name: "Basquete", metrics: BASKETBALL_METRICS },
];

export const COMPETITIONS: Competition[] = [
  { id: "brasileirao", name: "Brasileirão Série A", country: "Brasil", sport: "football", season: "2026" },
  { id: "laliga", name: "La Liga", country: "Espanha", sport: "football", season: "2025/26" },
  { id: "premier", name: "Premier League", country: "Inglaterra", sport: "football", season: "2025/26" },
  { id: "ucl", name: "Champions League", country: "Europa", sport: "football", season: "2025/26" },
  { id: "atp", name: "ATP Tour", country: "Internacional", sport: "tennis", season: "2026" },
  { id: "nba", name: "NBA", country: "EUA", sport: "basketball", season: "2025/26" },
];

export const TEAMS: Team[] = [
  { id: "corinthians", name: "Corinthians", shortName: "COR", country: "Brasil", competitionId: "brasileirao", colors: ["#111827", "#e5e7eb"], founded: 1910 },
  { id: "flamengo", name: "Flamengo", shortName: "FLA", country: "Brasil", competitionId: "brasileirao", colors: ["#b91c1c", "#111827"], founded: 1895 },
  { id: "real-madrid", name: "Real Madrid", shortName: "RMA", country: "Espanha", competitionId: "laliga", colors: ["#e5e7eb", "#f59e0b"], founded: 1902 },
  { id: "barcelona", name: "Barcelona", shortName: "BAR", country: "Espanha", competitionId: "laliga", colors: ["#1d4ed8", "#991b1b"], founded: 1899 },
  { id: "liverpool", name: "Liverpool", shortName: "LIV", country: "Inglaterra", competitionId: "premier", colors: ["#dc2626", "#facc15"], founded: 1892 },
  { id: "manchester-city", name: "Manchester City", shortName: "MCI", country: "Inglaterra", competitionId: "premier", colors: ["#38bdf8", "#0f172a"], founded: 1880 },
];

export const PLAYERS: Player[] = [
  { id: "nico-williams", name: "Nico Williams", teamId: "barcelona", sport: "football", position: "Ponta esquerda", nationality: "Espanha", age: 23, competitionId: "laliga", initials: "NW" },
  { id: "lamine-yamal", name: "Lamine Yamal", teamId: "barcelona", sport: "football", position: "Ponta direita", nationality: "Espanha", age: 19, competitionId: "laliga", initials: "LY" },
  { id: "vinicius-junior", name: "Vinícius Júnior", teamId: "real-madrid", sport: "football", position: "Ponta esquerda", nationality: "Brasil", age: 26, competitionId: "laliga", initials: "VJ" },
  { id: "mohamed-salah", name: "Mohamed Salah", teamId: "liverpool", sport: "football", position: "Ponta direita", nationality: "Egito", age: 34, competitionId: "premier", initials: "MS" },
  { id: "erling-haaland", name: "Erling Haaland", teamId: "manchester-city", sport: "football", position: "Centroavante", nationality: "Noruega", age: 26, competitionId: "premier", initials: "EH" },
  { id: "alexander-zverev", name: "Alexander Zverev", teamId: null, sport: "tennis", position: "Simples masculino", nationality: "Alemanha", age: 29, competitionId: "atp", initials: "AZ" },
  { id: "jannik-sinner", name: "Jannik Sinner", teamId: null, sport: "tennis", position: "Simples masculino", nationality: "Itália", age: 24, competitionId: "atp", initials: "JS" },
  { id: "carlos-alcaraz", name: "Carlos Alcaraz", teamId: null, sport: "tennis", position: "Simples masculino", nationality: "Espanha", age: 23, competitionId: "atp", initials: "CA" },
];

export function getSport(id: SportId): Sport {
  return SPORTS.find((s) => s.id === id) ?? SPORTS[0];
}

export function getCompetition(id: string | null | undefined): Competition | undefined {
  return COMPETITIONS.find((c) => c.id === id);
}

export function getTeam(id: string): Team | undefined {
  return TEAMS.find((t) => t.id === id);
}

export function getPlayer(id: string): Player | undefined {
  return PLAYERS.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/* Geração determinística de partidas demonstrativas                    */
/* ------------------------------------------------------------------ */

export interface MatchRecord {
  id: string;
  date: string;
  opponent: string;
  competition: string;
  venue: "home" | "away";
  result: string;
  outcome: "V" | "E" | "D";
  value: number;
  source: string;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const OPPONENTS: Record<SportId, string[]> = {
  football: [
    "Palmeiras", "São Paulo", "Grêmio", "Internacional", "Fluminense", "Atlético-MG",
    "Sevilla", "Valencia", "Athletic Club", "Villarreal", "Arsenal", "Chelsea",
    "Tottenham", "Newcastle", "Napoli", "Inter", "Bayern", "PSG",
  ],
  tennis: [
    "D. Medvedev", "S. Tsitsipas", "H. Rune", "T. Fritz", "A. de Minaur", "C. Ruud",
    "G. Dimitrov", "B. Shelton", "K. Khachanov", "A. Rublev", "F. Tiafoe", "U. Humbert",
  ],
  basketball: ["Celtics", "Nuggets", "Lakers", "Heat", "Bucks", "Suns", "Knicks", "Mavericks"],
};

export function generateMatches(params: {
  entityId: string;
  sport: SportId;
  metric: MetricDef;
  count: number;
  competitionName: string;
}): MatchRecord[] {
  const { entityId, sport, metric, count, competitionName } = params;
  const rand = mulberry(hashSeed(`${entityId}:${metric.key}`));
  const pool = OPPONENTS[sport];
  const out: MatchRecord[] = [];
  const start = new Date("2026-07-20T00:00:00.000Z").getTime();

  for (let i = 0; i < count; i++) {
    const venue: "home" | "away" = rand() > 0.5 ? "home" : "away";
    const drift = (count - i) / count; // leve tendência recente
    const raw = metric.base + (rand() - 0.45) * metric.spread + (venue === "home" ? metric.spread * 0.12 : -metric.spread * 0.08) + drift * metric.spread * 0.06;
    const decimals = metric.base > 20 ? 0 : metric.base > 8 ? 0 : 0;
    const value = Math.max(0, Number(raw.toFixed(decimals)));
    const gf = Math.round(rand() * 3);
    const ga = Math.round(rand() * 2.6);
    out.push({
      id: `${entityId}-${metric.key}-${i}`,
      date: new Date(start - i * (1000 * 60 * 60 * 24 * (5 + Math.floor(rand() * 4)))).toISOString(),
      opponent: pool[Math.floor(rand() * pool.length)],
      competition: competitionName,
      venue,
      result: sport === "tennis" ? (rand() > 0.35 ? "2-0" : "1-2") : `${gf}-${ga}`,
      outcome: sport === "tennis" ? (rand() > 0.35 ? "V" : "D") : gf > ga ? "V" : gf === ga ? "E" : "D",
      value,
      source: DATA_SOURCE.provider,
    });
  }
  return out.reverse(); // do mais antigo para o mais recente
}

/* ------------------------------------------------------------------ */
/* Conteúdo de vitrine                                                  */
/* ------------------------------------------------------------------ */

export const QUICK_SUGGESTIONS = [
  "Comparar dois jogadores",
  "Analisar últimos jogos",
  "Encontrar líderes de uma estatística",
  "Comparar casa e fora",
  "Analisar uma equipe",
  "Explorar uma competição",
];

export const FEATURED_ANALYSES: { title: string; question: string; tag: string }[] = [
  { title: "Média de aces de Alexander Zverev", question: "Quantos aces Alexander Zverev teve, em média, nos últimos 30 jogos?", tag: "Tênis · ATP" },
  { title: "Escanteios do Corinthians", question: "Qual foi a média de escanteios do Corinthians nos últimos 20 jogos?", tag: "Futebol · Brasileirão" },
  { title: "Faltas recebidas em La Liga", question: "Compare Nico Williams e Lamine Yamal em faltas recebidas nos últimos 10 jogos", tag: "Futebol · La Liga" },
  { title: "Flamengo fora de casa", question: "Mostre o desempenho do Flamengo em jogos fora de casa", tag: "Futebol · Brasileirão" },
  { title: "Finalizações no alvo na Premier League", question: "Média de finalizações no alvo de Mohamed Salah nos últimos 15 jogos", tag: "Futebol · Premier League" },
  { title: "Gols do Real Madrid", question: "Qual a média de gols do Real Madrid nos últimos 10 jogos?", tag: "Futebol · La Liga" },
];

export interface FixtureCard {
  id: string;
  homeId: string;
  awayId: string;
  competitionId: string;
  kickoff: string;
  status: "finished" | "live" | "scheduled";
  score?: string;
}

export const FIXTURES: FixtureCard[] = [
  { id: "f1", homeId: "corinthians", awayId: "flamengo", competitionId: "brasileirao", kickoff: "2026-07-26T21:30:00.000Z", status: "finished", score: "2-1" },
  { id: "f2", homeId: "barcelona", awayId: "real-madrid", competitionId: "laliga", kickoff: "2026-07-27T19:00:00.000Z", status: "finished", score: "1-1" },
  { id: "f3", homeId: "liverpool", awayId: "manchester-city", competitionId: "premier", kickoff: "2026-07-29T16:00:00.000Z", status: "live", score: "0-0" },
  { id: "f4", homeId: "real-madrid", awayId: "liverpool", competitionId: "ucl", kickoff: "2026-08-02T20:00:00.000Z", status: "scheduled" },
  { id: "f5", homeId: "flamengo", awayId: "barcelona", competitionId: "ucl", kickoff: "2026-08-05T22:00:00.000Z", status: "scheduled" },
  { id: "f6", homeId: "manchester-city", awayId: "corinthians", competitionId: "ucl", kickoff: "2026-08-09T18:00:00.000Z", status: "scheduled" },
];

export const PLANS = [
  {
    id: "free",
    name: "Gratuito",
    price: "R$ 0",
    period: "para sempre",
    quota: 10,
    highlight: false,
    features: ["10 análises por mês", "Dados demonstrativos", "Histórico limitado", "1 workspace"],
    cta: "Começar agora",
  },
  {
    id: "essential",
    name: "Essencial",
    price: "R$ 39,90",
    period: "por mês",
    quota: 150,
    highlight: false,
    features: ["150 análises por mês", "Análises completas", "5 workspaces", "Exportação", "Histórico ampliado"],
    cta: "Assinar Essencial",
  },
  {
    id: "pro",
    name: "Profissional",
    price: "R$ 89,90",
    period: "por mês",
    quota: 600,
    highlight: true,
    features: ["600 análises por mês", "Análises avançadas", "Comparações", "Exportação em CSV", "Workspaces ilimitados", "Prioridade de processamento"],
    cta: "Assinar Profissional",
  },
  {
    id: "teams",
    name: "Equipes",
    price: "Sob consulta",
    period: "preço personalizado",
    quota: 9999,
    highlight: false,
    features: ["Múltiplos usuários", "Espaços compartilhados", "Relatórios", "Integrações", "Suporte dedicado", "Controle administrativo"],
    cta: "Falar com vendas",
  },
];

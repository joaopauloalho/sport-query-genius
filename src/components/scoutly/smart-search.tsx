import { ArrowRight, Home, Search, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPETITIONS, SPORTS } from "@/data/sports";
import {
  SUPPORTED_MATCH_COUNTS,
  type AnalysisOverrides,
  type AnalysisVenue,
  type SupportedMatchCount,
} from "@/lib/analysis-request";
import { cn } from "@/lib/utils";

export interface SearchFilters {
  sport: "football";
  period: `${SupportedMatchCount}`;
  competition: string;
  venue: AnalysisVenue;
}

interface ExplicitFilters {
  period: boolean;
  competition: boolean;
  venue: boolean;
}

export const DEFAULT_FILTERS: SearchFilters = {
  sport: "football",
  period: "10",
  competition: "all",
  venue: "all",
};

export const PLACEHOLDER =
  "Ex.: Qual foi a média de escanteios do Corinthians nos últimos 20 jogos?";

const FOOTBALL_SPORTS = SPORTS.filter((sport) => sport.id === "football");
const FOOTBALL_COMPETITIONS = COMPETITIONS.filter((competition) => competition.sport === "football");

export function SmartSearch({
  onSubmit,
  defaultValue = "",
  showFilters = true,
  autoFocus = false,
  size = "lg",
  className,
}: {
  onSubmit: (question: string, filters: SearchFilters, overrides?: AnalysisOverrides) => void;
  defaultValue?: string;
  showFilters?: boolean;
  autoFocus?: boolean;
  size?: "lg" | "sm";
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [explicit, setExplicit] = useState<ExplicitFilters>({
    period: false,
    competition: false,
    venue: false,
  });

  function buildOverrides(): AnalysisOverrides | undefined {
    const overrides: AnalysisOverrides = {};

    if (explicit.period) {
      overrides.match_count = Number(filters.period) as SupportedMatchCount;
    }
    if (explicit.competition) {
      overrides.competition = filters.competition === "all" ? null : filters.competition;
    }
    if (explicit.venue) {
      overrides.venue = filters.venue;
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim(), filters, buildOverrides());
  }

  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)}>
      <div
        className={cn(
          "surface-card group flex items-center gap-3 px-4 transition-all focus-within:glow-ring",
          size === "lg" ? "py-3" : "py-2",
        )}
      >
        <Search className="size-5 shrink-0 text-muted-foreground" />
        <input
          aria-label="Pergunta de análise esportiva"
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={PLACEHOLDER}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
            size === "lg" ? "py-2 text-base" : "text-sm",
          )}
        />
        <Button type="submit" size={size === "lg" ? "default" : "sm"} className="shrink-0 gap-1.5">
          Analisar
          <ArrowRight className="size-4" />
        </Button>
      </div>

      {showFilters && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Sparkles className="size-3.5 text-muted-foreground" />
          <Select value={filters.sport}>
            <SelectTrigger className="h-8 w-auto min-w-[8rem] rounded-full text-xs" aria-label="Esporte">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FOOTBALL_SPORTS.map((sport) => (
                <SelectItem key={sport.id} value={sport.id}>
                  {sport.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.period}
            onValueChange={(period) => {
              setFilters({ ...filters, period: period as SearchFilters["period"] });
              setExplicit({ ...explicit, period: true });
            }}
          >
            <SelectTrigger className="h-8 w-auto min-w-[9rem] rounded-full text-xs" aria-label="Período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_MATCH_COUNTS.map((period) => (
                <SelectItem key={period} value={String(period)}>
                  Últimos {period} jogos
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.competition}
            onValueChange={(competition) => {
              setFilters({ ...filters, competition });
              setExplicit({ ...explicit, competition: true });
            }}
          >
            <SelectTrigger className="h-8 w-auto min-w-[10rem] rounded-full text-xs" aria-label="Competição">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as competições</SelectItem>
              {FOOTBALL_COMPETITIONS.map((competition) => (
                <SelectItem key={competition.id} value={competition.id}>
                  {competition.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.venue}
            onValueChange={(venue) => {
              setFilters({ ...filters, venue: venue as AnalysisVenue });
              setExplicit({ ...explicit, venue: true });
            }}
          >
            <SelectTrigger className="h-8 w-auto min-w-[8.5rem] rounded-full text-xs" aria-label="Mando">
              <Home className="mr-1 size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Casa e fora</SelectItem>
              <SelectItem value="home">Em casa</SelectItem>
              <SelectItem value="away">Fora de casa</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </form>
  );
}

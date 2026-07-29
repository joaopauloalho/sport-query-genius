import { ArrowRight, Mic, Search, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPETITIONS, SPORTS } from "@/data/sports";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface SearchFilters {
  sport: string;
  period: string;
  competition: string;
}

export const DEFAULT_FILTERS: SearchFilters = { sport: "football", period: "10", competition: "all" };

export const PLACEHOLDER =
  "Ex.: Qual foi a média de escanteios do Corinthians nos últimos 20 jogos?";

export function SmartSearch({
  onSubmit,
  defaultValue = "",
  showFilters = true,
  autoFocus = false,
  size = "lg",
  className,
}: {
  onSubmit: (question: string, filters: SearchFilters) => void;
  defaultValue?: string;
  showFilters?: boolean;
  autoFocus?: boolean;
  size?: "lg" | "sm";
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim(), filters);
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
          onChange={(e) => setValue(e.target.value)}
          placeholder={PLACEHOLDER}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
            size === "lg" ? "py-2 text-base" : "text-sm",
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Pesquisar por voz"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => toast.info("Entrada por voz chega na próxima versão do MVP.")}
        >
          <Mic className="size-4.5" />
        </Button>
        <Button type="submit" size={size === "lg" ? "default" : "sm"} className="shrink-0 gap-1.5">
          Analisar
          <ArrowRight className="size-4" />
        </Button>
      </div>

      {showFilters && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Sparkles className="size-3.5 text-muted-foreground" />
          <Select value={filters.sport} onValueChange={(v) => setFilters({ ...filters, sport: v })}>
            <SelectTrigger className="h-8 w-auto min-w-[8rem] rounded-full text-xs" aria-label="Esporte">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.period} onValueChange={(v) => setFilters({ ...filters, period: v })}>
            <SelectTrigger className="h-8 w-auto min-w-[9rem] rounded-full text-xs" aria-label="Período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["5", "10", "15", "20", "30"].map((p) => (
                <SelectItem key={p} value={p}>
                  Últimos {p} jogos
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.competition} onValueChange={(v) => setFilters({ ...filters, competition: v })}>
            <SelectTrigger className="h-8 w-auto min-w-[10rem] rounded-full text-xs" aria-label="Competição">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as competições</SelectItem>
              {COMPETITIONS.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </form>
  );
}

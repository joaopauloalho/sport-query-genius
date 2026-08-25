import { ArrowUpDown, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MatchRecord } from "@/data/sports";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 8;

export function MatchesTable({
  matches,
  metricLabel,
  onExport,
}: {
  matches: MatchRecord[];
  metricLabel: string;
  onExport?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState("all");
  const [sortDesc, setSortDesc] = useState(true);
  const [sortKey, setSortKey] = useState<"date" | "value">("date");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const filtered = matches.filter(
      (m) =>
        (venue === "all" || m.venue === venue) &&
        (query === "" ||
          `${m.opponent} ${m.competition}`.toLowerCase().includes(query.toLowerCase())),
    );
    return [...filtered].sort((a, b) => {
      const av = sortKey === "date" ? new Date(a.date).getTime() : a.value;
      const bv = sortKey === "date" ? new Date(b.date).getTime() : b.value;
      return sortDesc ? bv - av : av - bv;
    });
  }, [matches, query, venue, sortDesc, sortKey]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: "date" | "value") {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar adversário ou competição"
            aria-label="Buscar na tabela"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={venue}
            onValueChange={(v) => {
              setVenue(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-9 w-[7.5rem] text-xs" aria-label="Filtrar mando de campo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="home">Casa</SelectItem>
              <SelectItem value="away">Fora</SelectItem>
            </SelectContent>
          </Select>
          {onExport && (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onExport}>
              <Download className="size-4" />
              <span className="hidden sm:inline">CSV</span>
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <button
                  className="inline-flex items-center gap-1"
                  onClick={() => toggleSort("date")}
                >
                  Data <ArrowUpDown className="size-3" />
                </button>
              </TableHead>
              <TableHead>Adversário</TableHead>
              <TableHead className="hidden md:table-cell">Competição</TableHead>
              <TableHead>Mando</TableHead>
              <TableHead className="hidden sm:table-cell">Resultado</TableHead>
              <TableHead className="text-right">
                <button
                  className="inline-flex items-center gap-1"
                  onClick={() => toggleSort("value")}
                >
                  {metricLabel} <ArrowUpDown className="size-3" />
                </button>
              </TableHead>
              <TableHead className="hidden lg:table-cell">Fonte</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {new Date(m.date).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell className="font-medium">{m.opponent}</TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">
                  {m.competition}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
                      m.venue === "home"
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {m.venue === "home" ? "Casa" : "Fora"}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell tabular-nums">
                  <span className="text-muted-foreground">{m.result}</span>
                  <span
                    className={cn(
                      "ml-2 font-semibold",
                      m.outcome === "V"
                        ? "text-success"
                        : m.outcome === "D"
                          ? "text-destructive"
                          : "text-warning",
                    )}
                  >
                    {m.outcome}
                  </span>
                </TableCell>
                <TableCell className="text-right font-display font-semibold tabular-nums">
                  {m.value}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {m.source}
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma partida encontrada com esses filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {rows.length} partidas · página {current + 1} de {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}

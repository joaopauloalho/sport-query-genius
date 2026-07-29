import { Database, Info, RefreshCw } from "lucide-react";

import { DATA_SOURCE } from "@/data/sports";
import { cn } from "@/lib/utils";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-[0.7rem] font-semibold tracking-wide text-lime uppercase",
        className,
      )}
    >
      <Database className="size-3" />
      Dados demonstrativos
    </span>
  );
}

export function SourceBadge({ updatedAt, className }: { updatedAt?: string; className?: string }) {
  const date = new Date(updatedAt ?? DATA_SOURCE.updatedAt);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1.5">
        <Database className="size-3.5" />
        Fonte: {DATA_SOURCE.provider}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <RefreshCw className="size-3.5" />
        Atualizado em {date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
      </span>
    </div>
  );
}

export function MethodologyNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-xs leading-relaxed text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      {DATA_SOURCE.methodologyNote}
    </p>
  );
}

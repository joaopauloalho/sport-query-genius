import { Activity } from "lucide-react";

import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Activity className="size-4.5" strokeWidth={2.6} />
      </span>
      {!compact && (
        <span className="font-display text-[1.05rem] font-bold tracking-tight">
          Scoutly<span className="text-primary"> AI</span>
        </span>
      )}
    </span>
  );
}

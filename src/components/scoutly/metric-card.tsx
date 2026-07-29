import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  suffix,
  hint,
  trend,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  hint?: string;
  trend?: number;
  emphasis?: boolean;
}) {
  const TrendIcon = trend === undefined ? null : trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        "surface-card animate-rise p-4 transition-colors hover:border-primary/40",
        emphasis && "border-primary/40 bg-primary/5",
      )}
    >
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-display text-2xl font-bold tabular-nums">{value}</span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {(hint || TrendIcon) && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {TrendIcon && (
            <TrendIcon
              className={cn("size-3.5", trend! > 0 ? "text-success" : trend! < 0 ? "text-destructive" : "")}
            />
          )}
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}

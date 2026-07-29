import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChartKind = "line" | "bar" | "area";

export interface ChartPoint {
  label: string;
  value: number;
  opponent?: string;
  venue?: string;
  compare?: number;
}

const KINDS: { id: ChartKind; label: string }[] = [
  { id: "line", label: "Linha" },
  { id: "bar", label: "Barras" },
  { id: "area", label: "Distribuição" },
];

function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as ChartPoint;
  return (
    <div className="surface-card px-3 py-2 text-xs">
      <p className="font-semibold">{label}</p>
      {point.opponent && (
        <p className="text-muted-foreground">
          {point.venue} · vs {point.opponent}
        </p>
      )}
      {payload.map((p: any) => (
        <p key={p.dataKey} className="mt-1 tabular-nums">
          <span className="text-muted-foreground">{p.dataKey === "compare" ? "Comparação" : "Valor"}: </span>
          {p.value} {unit}
        </p>
      ))}
    </div>
  );
}

export function PerformanceChart({
  data,
  unit = "",
  average,
  hasCompare = false,
  className,
  height = 300,
}: {
  data: ChartPoint[];
  unit?: string;
  average?: number;
  hasCompare?: boolean;
  className?: string;
  height?: number;
}) {
  const [kind, setKind] = useState<ChartKind>("line");
  const axis = { stroke: "var(--color-muted-foreground)", fontSize: 11, tickLine: false, axisLine: false };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Evolução partida a partida
          {average !== undefined && <span className="ml-2 tabular-nums">· média {average}</span>}
        </div>
        <div className="flex gap-1 rounded-full border border-border bg-secondary/60 p-1">
          {KINDS.map((k) => (
            <Button
              key={k.id}
              type="button"
              size="sm"
              variant={kind === k.id ? "default" : "ghost"}
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </Button>
          ))}
        </div>
      </div>

      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} content={<ChartTooltip unit={unit} />} />
              <Bar dataKey="value" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
              {hasCompare && <Bar dataKey="compare" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />}
            </BarChart>
          ) : kind === "area" ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="fillValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip content={<ChartTooltip unit={unit} />} />
              <Area dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#fillValue)" />
              {hasCompare && (
                <Area dataKey="compare" stroke="var(--color-chart-2)" strokeWidth={2} fill="transparent" />
              )}
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip content={<ChartTooltip unit={unit} />} />
              <Line
                dataKey="value"
                stroke="var(--color-chart-1)"
                strokeWidth={2.4}
                dot={{ r: 2.5, fill: "var(--color-chart-1)" }}
                activeDot={{ r: 5 }}
              />
              {hasCompare && (
                <Line
                  dataKey="compare"
                  stroke="var(--color-chart-2)"
                  strokeWidth={2.4}
                  dot={{ r: 2.5, fill: "var(--color-chart-2)" }}
                />
              )}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

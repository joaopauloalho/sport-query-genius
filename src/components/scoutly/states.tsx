import { Loader2, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { PROCESSING_STEPS } from "@/lib/analysis";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function ProcessingSteps({ className }: { className?: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, PROCESSING_STEPS.length - 1)), 260);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={cn("surface-card mx-auto w-full max-w-lg p-6", className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-primary" />
        Processando sua análise
      </div>
      <ol className="mt-5 space-y-3">
        {PROCESSING_STEPS.map((label, i) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-3 text-sm transition-opacity",
              i <= step ? "text-foreground opacity-100" : "text-muted-foreground opacity-45",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                i < step
                  ? "bg-lime"
                  : i === step
                    ? "animate-pulse-soft bg-primary"
                    : "bg-muted-foreground",
              )}
            />
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  onAction,
  className,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn("surface-card flex flex-col items-center px-6 py-12 text-center", className)}
    >
      <span className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX className="size-5" />
      </span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && onAction && (
        <Button className="mt-5" variant="outline" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

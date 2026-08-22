import type { SportsCacheObserver } from "@/server/sports/cache/cache-observer";

export type AnalysisTelemetrySnapshot = {
  cacheStatus: "hit" | "miss" | "mixed" | "unknown";
  cacheHitCount: number;
  cacheMissCount: number;
  providersCalled: string[];
};

export class AnalysisExecutionTelemetry implements SportsCacheObserver {
  private hits = 0;
  private misses = 0;
  private readonly providers = new Set<string>();

  cacheHit(): void {
    this.hits += 1;
  }

  cacheMiss(): void {
    this.misses += 1;
  }

  providerCall(provider: string): void {
    this.providers.add(provider);
  }

  snapshot(): AnalysisTelemetrySnapshot {
    const cacheStatus =
      this.hits > 0 && this.misses > 0
        ? "mixed"
        : this.hits > 0
          ? "hit"
          : this.misses > 0
            ? "miss"
            : "unknown";

    return {
      cacheStatus,
      cacheHitCount: this.hits,
      cacheMissCount: this.misses,
      providersCalled: [...this.providers],
    };
  }
}

export interface SportsCacheObserver {
  cacheHit(provider: string, kind: string): void;
  cacheMiss(provider: string, kind: string): void;
  providerCall(provider: string, operation: string): void;
}

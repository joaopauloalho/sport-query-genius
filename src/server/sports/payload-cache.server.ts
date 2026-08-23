import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PAYLOAD_CACHE_TABLE = "sports_provider_payload_cache";

export interface ProviderPayloadCacheEntry<T = unknown> {
  payload: T;
  fetchedAt: string;
  expiresAt: string;
}

export interface ProviderPayloadCacheRepository {
  get<T = unknown>(
    provider: string,
    dataFamily: string,
    cacheKey: string,
  ): Promise<ProviderPayloadCacheEntry<T> | null>;
  set<T = unknown>(params: {
    provider: string;
    dataFamily: string;
    cacheKey: string;
    payload: T;
    ttlMs: number;
  }): Promise<ProviderPayloadCacheEntry<T>>;
}

function fail(operation: string, error: { message: string } | null): void {
  if (error)
    throw new Error(`Supabase provider payload cache ${operation} failed: ${error.message}`);
}

export class SupabaseProviderPayloadCacheRepository implements ProviderPayloadCacheRepository {
  constructor(private readonly client: SupabaseClient) {}

  async get<T = unknown>(
    provider: string,
    dataFamily: string,
    cacheKey: string,
  ): Promise<ProviderPayloadCacheEntry<T> | null> {
    const { data, error } = await this.client
      .from(PAYLOAD_CACHE_TABLE)
      .select("payload,fetched_at,expires_at")
      .eq("provider", provider)
      .eq("data_family", dataFamily)
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    fail("lookup", error);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      payload: row.payload as T,
      fetchedAt: String(row.fetched_at),
      expiresAt: String(row.expires_at),
    };
  }

  async set<T = unknown>(params: {
    provider: string;
    dataFamily: string;
    cacheKey: string;
    payload: T;
    ttlMs: number;
  }): Promise<ProviderPayloadCacheEntry<T>> {
    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + params.ttlMs).toISOString();
    const { error } = await this.client.from(PAYLOAD_CACHE_TABLE).upsert(
      {
        provider: params.provider,
        data_family: params.dataFamily,
        cache_key: params.cacheKey,
        payload: params.payload,
        fetched_at: fetchedAt,
        expires_at: expiresAt,
        updated_at: fetchedAt,
      },
      { onConflict: "provider,data_family,cache_key" },
    );
    fail("upsert", error);
    return { payload: params.payload, fetchedAt, expiresAt };
  }
}

let repository: ProviderPayloadCacheRepository | null | undefined;

export function createProviderPayloadCacheRepositoryFromEnv(): ProviderPayloadCacheRepository | null {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) return null;

  const client = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return new SupabaseProviderPayloadCacheRepository(client);
}

export function getProviderPayloadCacheRepository(): ProviderPayloadCacheRepository | null {
  if (repository === undefined) repository = createProviderPayloadCacheRepositoryFromEnv();
  return repository;
}

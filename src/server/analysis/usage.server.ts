import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isEventListAnalysisResult, type AnalysisResult } from "@/lib/analysis";
import type { AnalysisTelemetrySnapshot } from "./telemetry.server";

export type UsageTerminalStatus = "failed_user" | "failed_provider" | "failed_internal";

export type UsageGateDecision =
  | "allowed"
  | "duplicate_completed"
  | "duplicate_in_progress"
  | "duplicate_terminal"
  | "rate_limited"
  | "quota_blocked"
  | "concurrency_blocked";

export type UsageGateResult = {
  decision: UsageGateDecision;
  usageEventId: string | null;
  analysisHistoryId: string | null;
  retryAfterSeconds: number | null;
};

export class UsageGuardUnavailableError extends Error {
  constructor() {
    super("Usage guard unavailable");
    this.name = "UsageGuardUnavailableError";
  }
}

type UsageConfig = {
  burstLimit: number;
  burstWindowSeconds: number;
  maxConcurrent: number;
  leaseSeconds: number;
  quotaLimit: number | null;
  quotaWindowSeconds: number | null;
};

let adminClient: SupabaseClient | null | undefined;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UsageGuardUnavailableError();
  }
  return value;
}

function optionalPositiveInteger(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UsageGuardUnavailableError();
  }
  return value;
}

function readUsageConfig(): UsageConfig {
  const quotaLimit = optionalPositiveInteger("ANALYSIS_QUOTA_LIMIT");
  const quotaWindowSeconds = optionalPositiveInteger("ANALYSIS_QUOTA_WINDOW_SECONDS");
  if ((quotaLimit === null) !== (quotaWindowSeconds === null)) {
    console.error("[analysis-usage] incomplete quota configuration");
    throw new UsageGuardUnavailableError();
  }

  return {
    burstLimit: positiveInteger("ANALYSIS_RATE_LIMIT_MAX", 12),
    burstWindowSeconds: positiveInteger("ANALYSIS_RATE_LIMIT_WINDOW_SECONDS", 60),
    maxConcurrent: positiveInteger("ANALYSIS_MAX_CONCURRENT_PER_USER", 1),
    leaseSeconds: positiveInteger("ANALYSIS_LEASE_SECONDS", 180),
    quotaLimit,
    quotaWindowSeconds,
  };
}

function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;
  if (adminClient === null) throw new UsageGuardUnavailableError();

  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) {
    adminClient = null;
    console.error("[analysis-usage] server persistence configuration missing", {
      hasUrl: Boolean(url),
      hasSecretKey: Boolean(secretKey),
    });
    throw new UsageGuardUnavailableError();
  }

  adminClient = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

export async function beginAnalysisUsage(input: {
  userId: string;
  requestId: string;
  idempotencyKey: string;
}): Promise<UsageGateResult> {
  const config = readUsageConfig();
  const client = getAdminClient();
  const { data, error } = await client.rpc("begin_analysis_usage", {
    p_user_id: input.userId,
    p_request_id: input.requestId,
    p_idempotency_key: input.idempotencyKey,
    p_burst_limit: config.burstLimit,
    p_burst_window_seconds: config.burstWindowSeconds,
    p_max_concurrent: config.maxConcurrent,
    p_lease_seconds: config.leaseSeconds,
    p_quota_limit: config.quotaLimit,
    p_quota_window_seconds: config.quotaWindowSeconds,
  });

  if (error) {
    console.error("[analysis-usage] gate rpc failed", { dbCode: error.code ?? "RPC_ERROR" });
    throw new UsageGuardUnavailableError();
  }

  const row = firstRow(data);
  const decision = row?.decision;
  if (typeof decision !== "string") throw new UsageGuardUnavailableError();

  return {
    decision: decision as UsageGateDecision,
    usageEventId: typeof row?.usage_event_id === "string" ? row.usage_event_id : null,
    analysisHistoryId:
      typeof row?.analysis_history_id === "string" ? row.analysis_history_id : null,
    retryAfterSeconds:
      typeof row?.retry_after_seconds === "number" ? row.retry_after_seconds : null,
  };
}

export async function completeAnalysisUsage(input: {
  userId: string;
  usageEventId: string;
  result: AnalysisResult;
  telemetry: AnalysisTelemetrySnapshot;
  durationMs: number;
}): Promise<{ id: string; created_at: string }> {
  const client = getAdminClient();
  const provider =
    input.result.source.provider || input.telemetry.providersCalled.join(",") || null;
  const isEventList = isEventListAnalysisResult(input.result);
  const aggregation = isEventList ? "event_list" : input.result.intent.aggregation;
  const sampleCount = isEventList ? input.result.events.length : input.result.statistics.sample_size;

  const { data, error } = await client.rpc("complete_analysis_usage", {
    p_user_id: input.userId,
    p_usage_event_id: input.usageEventId,
    p_question: input.result.question,
    p_cache_key: input.result.cache_key,
    p_result_json: input.result,
    p_result_created_at: input.result.created_at,
    p_metric: input.result.intent.metric,
    p_aggregation: aggregation,
    p_match_count: sampleCount,
    p_provider: provider,
    p_cache_status: input.telemetry.cacheStatus,
    p_cache_hit_count: input.telemetry.cacheHitCount,
    p_cache_miss_count: input.telemetry.cacheMissCount,
    p_duration_ms: input.durationMs,
  });

  if (error) {
    console.error("[analysis-usage] completion rpc failed", { dbCode: error.code ?? "RPC_ERROR" });
    throw new UsageGuardUnavailableError();
  }

  const row = firstRow(data);
  if (typeof row?.history_id !== "string" || typeof row?.history_created_at !== "string") {
    throw new UsageGuardUnavailableError();
  }
  return { id: row.history_id, created_at: row.history_created_at };
}

export async function failAnalysisUsage(input: {
  userId: string;
  usageEventId: string;
  status: UsageTerminalStatus;
  errorCode: string;
  telemetry: AnalysisTelemetrySnapshot;
  durationMs: number;
}): Promise<void> {
  const client = getAdminClient();
  const provider = input.telemetry.providersCalled.join(",") || null;
  const { error } = await client.rpc("fail_analysis_usage", {
    p_user_id: input.userId,
    p_usage_event_id: input.usageEventId,
    p_status: input.status,
    p_error_code: input.errorCode,
    p_provider: provider,
    p_cache_status: input.telemetry.cacheStatus,
    p_cache_hit_count: input.telemetry.cacheHitCount,
    p_cache_miss_count: input.telemetry.cacheMissCount,
    p_duration_ms: input.durationMs,
  });
  if (error) {
    console.error("[analysis-usage] failure rpc failed", { dbCode: error.code ?? "RPC_ERROR" });
  }
}

export async function readCompletedAnalysis(
  userId: string,
  historyId: string,
): Promise<{ result: AnalysisResult; history: { id: string; created_at: string } } | null> {
  const client = getAdminClient();
  const { data, error } = await client
    .from("analysis_history")
    .select("id,created_at,result_json")
    .eq("id", historyId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[analysis-usage] duplicate history lookup failed", {
      dbCode: error.code ?? "QUERY_ERROR",
    });
    throw new UsageGuardUnavailableError();
  }
  if (!data) return null;

  return {
    result: data.result_json as AnalysisResult,
    history: { id: String(data.id), created_at: String(data.created_at) },
  };
}

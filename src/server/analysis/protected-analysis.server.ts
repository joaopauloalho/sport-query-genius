import { randomUUID } from "node:crypto";

import type { AnalysisRequest } from "@/lib/analysis-request";
import type { AnalysisAuthContext } from "@/server/auth/analysis-auth.server";
import { analyzeQuestionServer } from "./analyze.server";
import type { AnalysisErrorCode, ServerAnalysisOutcome } from "./errors";
import { AnalysisExecutionTelemetry } from "./telemetry.server";
import {
  beginAnalysisUsage,
  completeAnalysisUsage,
  failAnalysisUsage,
  readCompletedAnalysis,
  UsageGuardUnavailableError,
  type UsageTerminalStatus,
} from "./usage.server";

function logAnalysis(event: string, fields: Record<string, unknown>): void {
  console.info("[analysis]", { event, ...fields });
}

function terminalStatus(code: AnalysisErrorCode): UsageTerminalStatus {
  if (
    code === "TEAM_NOT_FOUND" ||
    code === "QUESTION_NOT_UNDERSTOOD" ||
    code === "UNSUPPORTED_METRIC" ||
    code === "UNSUPPORTED_FILTER"
  ) {
    return "failed_user";
  }

  if (
    code === "API_LIMIT_REACHED" ||
    code === "PROVIDER_UNAVAILABLE" ||
    code === "DATA_INSUFFICIENT" ||
    code === "DEEPSEEK_ERROR" ||
    code === "INVALID_DEEPSEEK_OUTPUT"
  ) {
    return "failed_provider";
  }

  return "failed_internal";
}

function blockedOutcome(
  code: AnalysisErrorCode,
  reason: string,
  retryAfterSeconds?: number | null,
): ServerAnalysisOutcome {
  return {
    ok: false,
    code,
    reason,
    ...(retryAfterSeconds ? { retry_after_seconds: retryAfterSeconds } : {}),
  };
}

export async function executeProtectedAnalysis(input: {
  request: AnalysisRequest;
  auth: AnalysisAuthContext;
}): Promise<ServerAnalysisOutcome> {
  const requestId = randomUUID();

  if (input.auth.status === "misconfigured") {
    logAnalysis("auth_configuration_failed", { request_id: requestId });
    return blockedOutcome(
      "USAGE_GUARD_UNAVAILABLE",
      "Não foi possível validar sua sessão com segurança agora. Tente novamente em instantes.",
    );
  }

  if (input.auth.status !== "authenticated") {
    logAnalysis("auth_failed", { request_id: requestId });
    return blockedOutcome(
      "UNAUTHORIZED",
      "Sua sessão expirou ou não é válida. Entre novamente para continuar.",
    );
  }

  const userId = input.auth.user.id;
  logAnalysis("auth_success", { request_id: requestId, user_id: userId });

  let gate;
  try {
    gate = await beginAnalysisUsage({
      userId,
      requestId,
      idempotencyKey: input.request.idempotency_key,
    });
  } catch (error) {
    if (error instanceof UsageGuardUnavailableError) {
      logAnalysis("usage_guard_failed", { request_id: requestId, user_id: userId });
      return blockedOutcome(
        "USAGE_GUARD_UNAVAILABLE",
        "Não foi possível validar o uso da análise agora. Nenhuma chamada esportiva foi executada.",
      );
    }
    throw error;
  }

  if (gate.decision === "duplicate_completed") {
    if (!gate.analysisHistoryId) {
      return blockedOutcome(
        "DUPLICATE_REQUEST",
        "Esta solicitação já foi processada. Inicie uma nova análise para tentar novamente.",
      );
    }
    try {
      const previous = await readCompletedAnalysis(userId, gate.analysisHistoryId);
      if (previous) {
        logAnalysis("idempotency_replay", {
          request_id: requestId,
          user_id: userId,
          usage_event_id: gate.usageEventId,
        });
        return { ok: true, result: previous.result, history: previous.history };
      }
    } catch (error) {
      if (!(error instanceof UsageGuardUnavailableError)) throw error;
    }
    return blockedOutcome(
      "DUPLICATE_REQUEST",
      "Esta solicitação já foi processada. Inicie uma nova análise para tentar novamente.",
    );
  }

  if (gate.decision === "duplicate_in_progress" || gate.decision === "concurrency_blocked") {
    logAnalysis("concurrency_blocked", {
      request_id: requestId,
      user_id: userId,
      retry_after_seconds: gate.retryAfterSeconds,
    });
    return blockedOutcome(
      "ANALYSIS_IN_PROGRESS",
      "Já existe uma análise em andamento para sua conta. Aguarde a conclusão antes de iniciar outra.",
      gate.retryAfterSeconds,
    );
  }

  if (gate.decision === "rate_limited") {
    logAnalysis("rate_limited", {
      request_id: requestId,
      user_id: userId,
      retry_after_seconds: gate.retryAfterSeconds,
    });
    return blockedOutcome(
      "RATE_LIMITED",
      "Muitas solicitações foram enviadas em pouco tempo. Aguarde um momento e tente novamente.",
      gate.retryAfterSeconds,
    );
  }

  if (gate.decision === "quota_blocked") {
    logAnalysis("quota_blocked", { request_id: requestId, user_id: userId });
    return blockedOutcome(
      "QUOTA_EXCEEDED",
      "O limite de uso configurado para sua conta foi atingido neste período.",
    );
  }

  if (gate.decision === "duplicate_terminal") {
    return blockedOutcome(
      "DUPLICATE_REQUEST",
      "Esta solicitação já foi encerrada. Inicie uma nova análise para tentar novamente.",
    );
  }

  if (gate.decision !== "allowed" || !gate.usageEventId) {
    return blockedOutcome(
      "USAGE_GUARD_UNAVAILABLE",
      "Não foi possível reservar esta análise com segurança. Nenhuma chamada esportiva foi executada.",
    );
  }

  const usageEventId = gate.usageEventId;
  const telemetry = new AnalysisExecutionTelemetry();
  const startedAt = Date.now();
  logAnalysis("usage_allowed", {
    request_id: requestId,
    user_id: userId,
    usage_event_id: usageEventId,
  });

  const outcome = await analyzeQuestionServer(input.request, telemetry);
  const durationMs = Math.max(0, Date.now() - startedAt);
  const snapshot = telemetry.snapshot();

  if (!outcome.ok) {
    await failAnalysisUsage({
      userId,
      usageEventId,
      status: terminalStatus(outcome.code),
      errorCode: outcome.code,
      telemetry: snapshot,
      durationMs,
    });
    logAnalysis("analysis_failed", {
      request_id: requestId,
      user_id: userId,
      usage_event_id: usageEventId,
      duration_ms: durationMs,
      cache_status: snapshot.cacheStatus,
      provider: snapshot.providersCalled.join(",") || null,
      error_code: outcome.code,
    });
    return outcome;
  }

  try {
    const history = await completeAnalysisUsage({
      userId,
      usageEventId,
      result: outcome.result,
      telemetry: snapshot,
      durationMs,
    });
    logAnalysis("analysis_completed", {
      request_id: requestId,
      user_id: userId,
      usage_event_id: usageEventId,
      duration_ms: durationMs,
      cache_status: snapshot.cacheStatus,
      provider: outcome.result.source.provider,
    });
    return { ok: true, result: outcome.result, history };
  } catch (error) {
    await failAnalysisUsage({
      userId,
      usageEventId,
      status: "failed_internal",
      errorCode: "USAGE_PERSISTENCE_FAILED",
      telemetry: snapshot,
      durationMs,
    });
    logAnalysis("analysis_persistence_failed", {
      request_id: requestId,
      user_id: userId,
      usage_event_id: usageEventId,
      duration_ms: durationMs,
      error_code: error instanceof UsageGuardUnavailableError ? "USAGE_GUARD_UNAVAILABLE" : "INTERNAL",
    });
    return blockedOutcome(
      "USAGE_GUARD_UNAVAILABLE",
      "A análise não pôde ser registrada com segurança. Tente novamente com uma nova solicitação.",
    );
  }
}

import type { AnalysisResult } from "@/lib/analysis";

export type AnalysisErrorCode =
  | "TEAM_NOT_FOUND"
  | "PLAYER_NOT_FOUND"
  | "ENTITY_AMBIGUOUS"
  | "QUESTION_NOT_UNDERSTOOD"
  | "UNSUPPORTED_METRIC"
  | "UNSUPPORTED_FILTER"
  | "UNSUPPORTED_CAPABILITY"
  | "API_LIMIT_REACHED"
  | "PROVIDER_UNAVAILABLE"
  | "DATA_INSUFFICIENT"
  | "DEEPSEEK_ERROR"
  | "INVALID_DEEPSEEK_OUTPUT"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "ANALYSIS_IN_PROGRESS"
  | "DUPLICATE_REQUEST"
  | "USAGE_GUARD_UNAVAILABLE";

export interface AnalysisEntityCandidate {
  id: string;
  name: string;
  provider: string;
  context?: string;
}

export class AnalysisPipelineError extends Error {
  constructor(
    public readonly code: AnalysisErrorCode,
    message: string,
    public readonly candidates?: AnalysisEntityCandidate[],
  ) {
    super(message);
    this.name = "AnalysisPipelineError";
  }
}

export function toSafeAnalysisError(error: unknown): {
  code: AnalysisErrorCode;
  reason: string;
  candidates?: AnalysisEntityCandidate[];
} {
  if (error instanceof AnalysisPipelineError) {
    return {
      code: error.code,
      reason: error.message,
      ...(error.candidates ? { candidates: error.candidates } : {}),
    };
  }

  return {
    code: "PROVIDER_UNAVAILABLE",
    reason:
      "Não foi possível concluir a análise agora. Nenhuma estatística foi estimada ou inventada.",
  };
}

export type AnalysisFailure = {
  ok: false;
  code: AnalysisErrorCode;
  reason: string;
  retry_after_seconds?: number;
  candidates?: AnalysisEntityCandidate[];
};

export type AnalysisPipelineOutcome = { ok: true; result: AnalysisResult } | AnalysisFailure;

export type ServerAnalysisOutcome =
  | {
      ok: true;
      result: AnalysisResult;
      history: { id: string; created_at: string };
    }
  | AnalysisFailure;

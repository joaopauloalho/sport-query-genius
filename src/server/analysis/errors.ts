import type { AnalysisResult } from "@/lib/analysis";

export type AnalysisErrorCode =
  | "TEAM_NOT_FOUND"
  | "QUESTION_NOT_UNDERSTOOD"
  | "UNSUPPORTED_METRIC"
  | "UNSUPPORTED_FILTER"
  | "API_LIMIT_REACHED"
  | "PROVIDER_UNAVAILABLE"
  | "DATA_INSUFFICIENT"
  | "DEEPSEEK_ERROR"
  | "INVALID_DEEPSEEK_OUTPUT";

export class AnalysisPipelineError extends Error {
  constructor(
    public readonly code: AnalysisErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisPipelineError";
  }
}

export function toSafeAnalysisError(error: unknown): {
  code: AnalysisErrorCode;
  reason: string;
} {
  if (error instanceof AnalysisPipelineError) {
    return { code: error.code, reason: error.message };
  }

  return {
    code: "PROVIDER_UNAVAILABLE",
    reason: "Não foi possível concluir a análise agora. Nenhuma estatística foi estimada ou inventada.",
  };
}

export type ServerAnalysisOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; code: AnalysisErrorCode; reason: string };

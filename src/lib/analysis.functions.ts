import { createServerFn } from "@tanstack/react-start";

import { analysisRequestSchema } from "@/lib/analysis-request";
import { analyzeQuestionServer } from "@/server/analysis/analyze.server";
import type { ServerAnalysisOutcome } from "@/server/analysis/errors";

export type { AnalysisOverrides, AnalysisRequest } from "@/lib/analysis-request";
export type { ServerAnalysisOutcome } from "@/server/analysis/errors";

export const analyzeQuestion = createServerFn({ method: "POST" })
  .validator(analysisRequestSchema)
  .handler(async ({ data }): Promise<ServerAnalysisOutcome> => analyzeQuestionServer(data));

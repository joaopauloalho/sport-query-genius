import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { analyzeQuestionServer } from "@/server/analysis/analyze.server";
import type { ServerAnalysisOutcome } from "@/server/analysis/errors";

export type { ServerAnalysisOutcome } from "@/server/analysis/errors";

const analyzeQuestionInputSchema = z
  .object({
    question: z.string().trim().min(3).max(500),
  })
  .strict();

export const analyzeQuestion = createServerFn({ method: "POST" })
  .validator(analyzeQuestionInputSchema)
  .handler(async ({ data }): Promise<ServerAnalysisOutcome> => analyzeQuestionServer(data.question));

import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { analysisRequestSchema } from "@/lib/analysis-request";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { validateAnalysisAuthorization } from "@/server/auth/analysis-auth.server";
import { executeProtectedAnalysis } from "@/server/analysis/protected-analysis.server";
import type { ServerAnalysisOutcome } from "@/server/analysis/errors";

export type { AnalysisOverrides, AnalysisRequest } from "@/lib/analysis-request";
export type { ServerAnalysisOutcome } from "@/server/analysis/errors";

const analysisAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const client = getBrowserSupabase();
    if (!client) return next();

    const { data } = await client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return next();

    return next({
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  })
  .server(async ({ next }) => {
    const analysisAuth = await validateAnalysisAuthorization(
      getRequestHeader("authorization"),
    );
    return next({ context: { analysisAuth } });
  });

export const analyzeQuestion = createServerFn({ method: "POST" })
  .middleware([analysisAuthMiddleware])
  .validator(analysisRequestSchema)
  .handler(
    async ({ data, context }): Promise<ServerAnalysisOutcome> =>
      executeProtectedAnalysis({ request: data, auth: context.analysisAuth }),
  );

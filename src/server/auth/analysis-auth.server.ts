import { createClient, type User } from "@supabase/supabase-js";

export type AnalysisAuthContext =
  | { status: "authenticated"; user: User }
  | { status: "unauthorized"; user: null }
  | { status: "misconfigured"; user: null };

function readBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export async function validateAnalysisAuthorization(
  authorization: string | null,
): Promise<AnalysisAuthContext> {
  const accessToken = readBearerToken(authorization);
  if (!accessToken) return { status: "unauthorized", user: null };

  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim();
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    console.error("[analysis-auth] server auth configuration missing", {
      hasUrl: Boolean(url),
      hasPublishableKey: Boolean(publishableKey),
    });
    return { status: "misconfigured", user: null };
  }

  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return { status: "unauthorized", user: null };

  return { status: "authenticated", user: data.user };
}

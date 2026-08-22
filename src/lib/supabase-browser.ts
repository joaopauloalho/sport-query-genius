import { createIsomorphicFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;

const getPublicConfig = createIsomorphicFn()
  .server(() => null)
  .client(() => {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim();
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    return url && publishableKey ? { url, publishableKey } : null;
  });

export const getBrowserSupabase = createIsomorphicFn()
  .server((): SupabaseClient | null => null)
  .client((): SupabaseClient | null => {
    if (browserClient !== undefined) return browserClient;
    const config = getPublicConfig();
    if (!config) {
      browserClient = null;
      return null;
    }

    browserClient = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    return browserClient;
  });

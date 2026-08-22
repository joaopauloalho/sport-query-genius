import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { getBrowserSupabase } from "@/lib/supabase-browser";

type AuthOperationResult = {
  ok: boolean;
  message?: string;
  needsEmailConfirmation?: boolean;
};

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<AuthOperationResult>;
  signUp: (email: string, password: string, displayName: string) => Promise<AuthOperationResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function displayNameFor(user: User): string {
  const metadataName = user.user_metadata?.display_name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  return user.email?.split("@")[0] ?? "Usuário";
}

async function ensureProfile(user: User): Promise<void> {
  const client = getBrowserSupabase();
  if (!client) return;

  const { error } = await client.from("profiles").upsert(
    {
      id: user.id,
      display_name: displayNameFor(user),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) throw error;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    const client = getBrowserSupabase();
    setConfigured(Boolean(client));
    if (!client) {
      setSession(null);
      setLoading(false);
      return;
    }

    let active = true;
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.warn("[auth] initial session failed", { message: error.message });
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    void ensureProfile(session.user).catch((error: unknown) => {
      console.warn("[auth] profile bootstrap failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }, [session?.user?.id]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthOperationResult> => {
    const client = getBrowserSupabase();
    if (!client) return { ok: false, message: "Supabase Auth ainda não está configurado neste ambiente." };

    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, message: error.message };
    if (data.user) await ensureProfile(data.user);
    return { ok: true };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string): Promise<AuthOperationResult> => {
      const client = getBrowserSupabase();
      if (!client) return { ok: false, message: "Supabase Auth ainda não está configurado neste ambiente." };

      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
        },
      });

      if (error) return { ok: false, message: error.message };
      if (data.user && data.session) await ensureProfile(data.user);
      return {
        ok: true,
        needsEmailConfirmation: Boolean(data.user && !data.session),
        message: data.user && !data.session ? "Confira seu e-mail para confirmar a conta antes de entrar." : undefined,
      };
    },
    [],
  );

  const signOut = useCallback(async () => {
    const client = getBrowserSupabase();
    if (!client) return;
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured,
      signIn,
      signUp,
      signOut,
    }),
    [session, loading, configured, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return value;
}

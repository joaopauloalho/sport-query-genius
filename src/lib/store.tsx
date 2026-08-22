import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AnalysisResult } from "@/lib/analysis";
import { PLANS } from "@/data/sports";
import { useAuth } from "@/lib/auth";
import { getBrowserSupabase } from "@/lib/supabase.client";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  analysisIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  question: string;
  cacheKey: string;
  createdAt: string;
  result: AnalysisResult;
}

export interface UserProfile {
  name: string;
  email: string;
  planId: string;
  favoriteSport: string;
  favoriteTeams: string[];
  purpose: string;
  onboarded: boolean;
}

interface State {
  theme: "dark" | "light";
  profile: UserProfile;
  usage: number;
  history: HistoryEntry[];
  saved: AnalysisResult[];
  cache: Record<string, AnalysisResult>;
  workspaces: Workspace[];
  workspaceItems: Record<string, AnalysisResult[]>;
  loadingUserData: boolean;
}

const THEME_STORAGE_KEY = "scoutly-theme-v1";
const LEGACY_STORAGE_KEY = "scoutly-ai-state-v1";

const defaultProfile: UserProfile = {
  name: "Usuário",
  email: "",
  planId: "free",
  favoriteSport: "football",
  favoriteTeams: [],
  purpose: "",
  onboarded: true,
};

const initialState: State = {
  theme: "dark",
  profile: defaultProfile,
  usage: 0,
  history: [],
  saved: [],
  cache: {},
  workspaces: [],
  workspaceItems: {},
  loadingUserData: true,
};

interface Ctx extends State {
  quota: number;
  planName: string;
  toggleTheme: () => void;
  refreshUserData: () => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  registerAnalysis: (result: AnalysisResult, wasCached: boolean) => Promise<void>;
  getCached: (cacheKey: string) => AnalysisResult | undefined;
  toggleSaved: (result: AnalysisResult) => Promise<void>;
  isSaved: (cacheKey: string) => boolean;
  createWorkspace: (name: string, description: string) => Promise<string | null>;
  addToWorkspace: (workspaceId: string, result: AnalysisResult) => Promise<void>;
  removeFromWorkspace: (workspaceId: string, cacheKey: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

const ScoutlyContext = createContext<Ctx | null>(null);

function asAnalysisResult(value: unknown): AnalysisResult {
  return value as AnalysisResult;
}

export function ScoutlyProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>(initialState);

  useEffect(() => {
    try {
      const theme = localStorage.getItem(THEME_STORAGE_KEY);
      if (theme === "light" || theme === "dark") {
        setState((current) => ({ ...current, theme }));
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Theme persistence is optional; user data never falls back to this storage.
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", state.theme === "light");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, state.theme);
    } catch {
      // Non-critical display preference.
    }
  }, [state.theme]);

  const refreshUserData = useCallback(async () => {
    const client = getBrowserSupabase();
    if (!client || !user) {
      setState((current) => ({
        ...current,
        profile: defaultProfile,
        usage: 0,
        history: [],
        saved: [],
        cache: {},
        workspaces: [],
        workspaceItems: {},
        loadingUserData: false,
      }));
      return;
    }

    setState((current) => ({ ...current, loadingUserData: true }));

    const [profileResponse, historyResponse, savedResponse, workspaceResponse, itemResponse] =
      await Promise.all([
        client.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
        client
          .from("analysis_history")
          .select("id,question,cache_key,result_json,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(60),
        client
          .from("saved_analyses")
          .select("cache_key,result_json,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        client
          .from("workspaces")
          .select("id,name,description,created_at,updated_at")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
        client
          .from("workspace_items")
          .select("workspace_id,cache_key,result_json,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

    const error =
      profileResponse.error ??
      historyResponse.error ??
      savedResponse.error ??
      workspaceResponse.error ??
      itemResponse.error;
    if (error) {
      setState((current) => ({ ...current, loadingUserData: false }));
      throw error;
    }

    const history: HistoryEntry[] = (historyResponse.data ?? []).map((row) => ({
      id: String(row.id),
      question: String(row.question),
      cacheKey: String(row.cache_key),
      createdAt: String(row.created_at),
      result: asAnalysisResult(row.result_json),
    }));
    const saved = (savedResponse.data ?? []).map((row) => asAnalysisResult(row.result_json));

    const itemsByWorkspace: Record<string, AnalysisResult[]> = {};
    const itemCacheKeysByWorkspace: Record<string, string[]> = {};
    for (const row of itemResponse.data ?? []) {
      const workspaceId = String(row.workspace_id);
      const result = asAnalysisResult(row.result_json);
      (itemsByWorkspace[workspaceId] ??= []).push(result);
      (itemCacheKeysByWorkspace[workspaceId] ??= []).push(String(row.cache_key));
    }

    const workspaces: Workspace[] = (workspaceResponse.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: String(row.description ?? ""),
      analysisIds: itemCacheKeysByWorkspace[String(row.id)] ?? [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));

    const cache: Record<string, AnalysisResult> = {};
    for (const entry of history) cache[entry.cacheKey] = entry.result;
    for (const result of saved) cache[result.cache_key] = result;
    for (const results of Object.values(itemsByWorkspace)) {
      for (const result of results) cache[result.cache_key] = result;
    }

    const displayName = profileResponse.data?.display_name?.trim();
    setState((current) => ({
      ...current,
      profile: {
        ...defaultProfile,
        name: displayName || user.email?.split("@")[0] || "Usuário",
        email: user.email ?? "",
      },
      usage: history.length,
      history,
      saved,
      cache,
      workspaces,
      workspaceItems: itemsByWorkspace,
      loadingUserData: false,
    }));
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refreshUserData().catch((error: unknown) => {
      console.warn("[user-data] load failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }, [authLoading, refreshUserData]);

  const toggleTheme = useCallback(
    () => setState((current) => ({ ...current, theme: current.theme === "dark" ? "light" : "dark" })),
    [],
  );

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      const client = getBrowserSupabase();
      if (!client || !user) return;
      const name = patch.name?.trim();
      if (name) {
        const { error } = await client
          .from("profiles")
          .update({ display_name: name, updated_at: new Date().toISOString() })
          .eq("id", user.id);
        if (error) throw error;
      }
      setState((current) => ({
        ...current,
        profile: { ...current.profile, ...patch, ...(name ? { name } : {}) },
      }));
    },
    [user],
  );

  const registerAnalysis = useCallback(
    async (result: AnalysisResult, wasCached: boolean) => {
      const client = getBrowserSupabase();
      if (!client || !user) return;

      const { data, error } = await client
        .from("analysis_history")
        .insert({
          user_id: user.id,
          question: result.question,
          cache_key: result.cache_key,
          result_json: result,
          created_at: result.created_at,
        })
        .select("id,created_at")
        .single();
      if (error) throw error;

      const entry: HistoryEntry = {
        id: String(data.id),
        question: result.question,
        cacheKey: result.cache_key,
        createdAt: String(data.created_at),
        result,
      };
      setState((current) => ({
        ...current,
        usage: wasCached ? current.usage : current.usage + 1,
        cache: { ...current.cache, [result.cache_key]: result },
        history: [entry, ...current.history].slice(0, 60),
      }));
    },
    [user],
  );

  const getCached = useCallback((cacheKey: string) => state.cache[cacheKey], [state.cache]);

  const toggleSaved = useCallback(
    async (result: AnalysisResult) => {
      const client = getBrowserSupabase();
      if (!client || !user) return;
      const existing = state.saved.some((analysis) => analysis.cache_key === result.cache_key);

      if (existing) {
        const { error } = await client
          .from("saved_analyses")
          .delete()
          .eq("user_id", user.id)
          .eq("cache_key", result.cache_key);
        if (error) throw error;
        setState((current) => ({
          ...current,
          saved: current.saved.filter((analysis) => analysis.cache_key !== result.cache_key),
        }));
        return;
      }

      const historyId = state.history.find((entry) => entry.cacheKey === result.cache_key)?.id ?? null;
      const { error } = await client.from("saved_analyses").upsert(
        {
          user_id: user.id,
          analysis_history_id: historyId,
          cache_key: result.cache_key,
          result_json: result,
        },
        { onConflict: "user_id,cache_key" },
      );
      if (error) throw error;
      setState((current) => ({
        ...current,
        saved: [result, ...current.saved.filter((analysis) => analysis.cache_key !== result.cache_key)],
        cache: { ...current.cache, [result.cache_key]: result },
      }));
    },
    [state.saved, state.history, user],
  );

  const isSaved = useCallback(
    (cacheKey: string) => state.saved.some((analysis) => analysis.cache_key === cacheKey),
    [state.saved],
  );

  const createWorkspace = useCallback(
    async (name: string, description: string): Promise<string | null> => {
      const client = getBrowserSupabase();
      if (!client || !user) return null;
      const { data, error } = await client
        .from("workspaces")
        .insert({ user_id: user.id, name: name.trim(), description: description.trim() })
        .select("id,name,description,created_at,updated_at")
        .single();
      if (error) throw error;

      const workspace: Workspace = {
        id: String(data.id),
        name: String(data.name),
        description: String(data.description ?? ""),
        analysisIds: [],
        createdAt: String(data.created_at),
        updatedAt: String(data.updated_at),
      };
      setState((current) => ({
        ...current,
        workspaces: [workspace, ...current.workspaces],
        workspaceItems: { ...current.workspaceItems, [workspace.id]: [] },
      }));
      return workspace.id;
    },
    [user],
  );

  const addToWorkspace = useCallback(
    async (workspaceId: string, result: AnalysisResult) => {
      const client = getBrowserSupabase();
      if (!client || !user) return;
      const historyId = state.history.find((entry) => entry.cacheKey === result.cache_key)?.id ?? null;
      const { error } = await client.from("workspace_items").upsert(
        {
          workspace_id: workspaceId,
          user_id: user.id,
          analysis_history_id: historyId,
          cache_key: result.cache_key,
          result_json: result,
        },
        { onConflict: "workspace_id,cache_key" },
      );
      if (error) throw error;

      setState((current) => ({
        ...current,
        cache: { ...current.cache, [result.cache_key]: result },
        workspaces: current.workspaces.map((workspace) =>
          workspace.id === workspaceId && !workspace.analysisIds.includes(result.cache_key)
            ? { ...workspace, analysisIds: [...workspace.analysisIds, result.cache_key] }
            : workspace,
        ),
        workspaceItems: {
          ...current.workspaceItems,
          [workspaceId]: [
            result,
            ...(current.workspaceItems[workspaceId] ?? []).filter(
              (analysis) => analysis.cache_key !== result.cache_key,
            ),
          ],
        },
      }));
    },
    [state.history, user],
  );

  const removeFromWorkspace = useCallback(
    async (workspaceId: string, cacheKey: string) => {
      const client = getBrowserSupabase();
      if (!client || !user) return;
      const { error } = await client
        .from("workspace_items")
        .delete()
        .eq("user_id", user.id)
        .eq("workspace_id", workspaceId)
        .eq("cache_key", cacheKey);
      if (error) throw error;
      setState((current) => ({
        ...current,
        workspaces: current.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? { ...workspace, analysisIds: workspace.analysisIds.filter((id) => id !== cacheKey) }
            : workspace,
        ),
        workspaceItems: {
          ...current.workspaceItems,
          [workspaceId]: (current.workspaceItems[workspaceId] ?? []).filter(
            (analysis) => analysis.cache_key !== cacheKey,
          ),
        },
      }));
    },
    [user],
  );

  const clearHistory = useCallback(async () => {
    const client = getBrowserSupabase();
    if (!client || !user) return;
    const { error } = await client.from("analysis_history").delete().eq("user_id", user.id);
    if (error) throw error;
    setState((current) => ({ ...current, history: [], usage: 0 }));
  }, [user]);

  const plan = PLANS.find((candidate) => candidate.id === state.profile.planId) ?? PLANS[0];

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      quota: plan.quota,
      planName: plan.name,
      toggleTheme,
      refreshUserData,
      updateProfile,
      registerAnalysis,
      getCached,
      toggleSaved,
      isSaved,
      createWorkspace,
      addToWorkspace,
      removeFromWorkspace,
      clearHistory,
    }),
    [
      state,
      plan,
      toggleTheme,
      refreshUserData,
      updateProfile,
      registerAnalysis,
      getCached,
      toggleSaved,
      isSaved,
      createWorkspace,
      addToWorkspace,
      removeFromWorkspace,
      clearHistory,
    ],
  );

  return <ScoutlyContext.Provider value={value}>{children}</ScoutlyContext.Provider>;
}

export function useScoutly(): Ctx {
  const context = useContext(ScoutlyContext);
  if (!context) throw new Error("useScoutly deve ser usado dentro de ScoutlyProvider");
  return context;
}

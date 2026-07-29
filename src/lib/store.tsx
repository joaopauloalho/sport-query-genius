import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AnalysisResult } from "@/lib/analysis";
import { PLANS } from "@/data/sports";

/**
 * Estado do aplicativo (persistido em localStorage neste MVP).
 * TODO(integração): substituir por tabelas do Lovable Cloud
 * (profiles, searches, saved_analyses, workspaces, workspace_items, usage_events, cached_queries).
 */

export interface WorkspaceNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  analysisIds: string[];
  pinnedEntities: string[];
  notes: WorkspaceNote[];
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  question: string;
  cacheKey: string;
  createdAt: string;
  cached: boolean;
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
}

const STORAGE_KEY = "scoutly-ai-state-v1";

const initialState: State = {
  theme: "dark",
  profile: {
    name: "Convidado",
    email: "voce@scoutly.ai",
    planId: "free",
    favoriteSport: "football",
    favoriteTeams: ["corinthians"],
    purpose: "Criação de conteúdo",
    onboarded: false,
  },
  usage: 0,
  history: [],
  saved: [],
  cache: {},
  workspaces: [
    {
      id: "ws-corinthians",
      name: "Workspace Corinthians",
      description: "Acompanhamento semanal do time e das métricas de escanteios.",
      analysisIds: [],
      pinnedEntities: ["corinthians"],
      notes: [{ id: "n1", text: "Checar escanteios antes do clássico.", createdAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    },
    {
      id: "ws-conteudo",
      name: "Workspace Conteúdo semanal",
      description: "Pautas e números para os vídeos da semana.",
      analysisIds: [],
      pinnedEntities: ["lamine-yamal", "nico-williams"],
      notes: [],
      createdAt: new Date().toISOString(),
    },
  ],
};

interface Ctx extends State {
  quota: number;
  planName: string;
  toggleTheme: () => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  registerAnalysis: (result: AnalysisResult, wasCached: boolean) => void;
  getCached: (cacheKey: string) => AnalysisResult | undefined;
  toggleSaved: (result: AnalysisResult) => void;
  isSaved: (cacheKey: string) => boolean;
  createWorkspace: (name: string, description: string) => void;
  addToWorkspace: (workspaceId: string, result: AnalysisResult) => void;
  addNote: (workspaceId: string, text: string) => void;
  clearHistory: () => void;
}

const ScoutlyContext = createContext<Ctx | null>(null);

export function ScoutlyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...initialState, ...(JSON.parse(raw) as State) });
    } catch {
      /* estado padrão */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    document.documentElement.classList.toggle("light", state.theme === "light");
  }, [state, hydrated]);

  const toggleTheme = useCallback(
    () => setState((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" })),
    [],
  );

  const updateProfile = useCallback(
    (patch: Partial<UserProfile>) => setState((s) => ({ ...s, profile: { ...s.profile, ...patch } })),
    [],
  );

  const registerAnalysis = useCallback((result: AnalysisResult, wasCached: boolean) => {
    setState((s) => ({
      ...s,
      usage: wasCached ? s.usage : s.usage + 1,
      cache: { ...s.cache, [result.cache_key]: result },
      history: [
        { id: result.id, question: result.question, cacheKey: result.cache_key, createdAt: result.created_at, cached: wasCached },
        ...s.history.filter((h) => h.cacheKey !== result.cache_key),
      ].slice(0, 60),
    }));
  }, []);

  const getCached = useCallback((cacheKey: string) => state.cache[cacheKey], [state.cache]);

  const toggleSaved = useCallback((result: AnalysisResult) => {
    setState((s) => ({
      ...s,
      saved: s.saved.some((a) => a.cache_key === result.cache_key)
        ? s.saved.filter((a) => a.cache_key !== result.cache_key)
        : [result, ...s.saved],
    }));
  }, []);

  const isSaved = useCallback((cacheKey: string) => state.saved.some((a) => a.cache_key === cacheKey), [state.saved]);

  const createWorkspace = useCallback((name: string, description: string) => {
    setState((s) => ({
      ...s,
      workspaces: [
        ...s.workspaces,
        {
          id: `ws-${Date.now()}`,
          name,
          description,
          analysisIds: [],
          pinnedEntities: [],
          notes: [],
          createdAt: new Date().toISOString(),
        },
      ],
    }));
  }, []);

  const addToWorkspace = useCallback((workspaceId: string, result: AnalysisResult) => {
    setState((s) => ({
      ...s,
      cache: { ...s.cache, [result.cache_key]: result },
      saved: s.saved.some((a) => a.cache_key === result.cache_key) ? s.saved : [result, ...s.saved],
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId && !w.analysisIds.includes(result.cache_key)
          ? { ...w, analysisIds: [...w.analysisIds, result.cache_key] }
          : w,
      ),
    }));
  }, []);

  const addNote = useCallback((workspaceId: string, text: string) => {
    setState((s) => ({
      ...s,
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, notes: [...w.notes, { id: `n-${Date.now()}`, text, createdAt: new Date().toISOString() }] }
          : w,
      ),
    }));
  }, []);

  const clearHistory = useCallback(() => setState((s) => ({ ...s, history: [] })), []);

  const plan = PLANS.find((p) => p.id === state.profile.planId) ?? PLANS[0];

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      quota: plan.quota,
      planName: plan.name,
      toggleTheme,
      updateProfile,
      registerAnalysis,
      getCached,
      toggleSaved,
      isSaved,
      createWorkspace,
      addToWorkspace,
      addNote,
      clearHistory,
    }),
    [state, plan, toggleTheme, updateProfile, registerAnalysis, getCached, toggleSaved, isSaved, createWorkspace, addToWorkspace, addNote, clearHistory],
  );

  return <ScoutlyContext.Provider value={value}>{children}</ScoutlyContext.Provider>;
}

export function useScoutly(): Ctx {
  const ctx = useContext(ScoutlyContext);
  if (!ctx) throw new Error("useScoutly deve ser usado dentro de ScoutlyProvider");
  return ctx;
}

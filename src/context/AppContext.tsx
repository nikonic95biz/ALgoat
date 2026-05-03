import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BotTradeRow, ScalperPaperSnapshot } from "@/lib/scalperPaperEngine";
import { createAssistantGreetingMessage } from "@/lib/chatGreeting";
import { inferBackendIdFromBaseUrl } from "@/lib/llmBackends";
import type { ChatMessage, ChatSession, GitHubWorkspaceSettings, ModelSettings, UserAlgoPreset } from "@/types";
import { githubGetFileContent, githubPutFileContent } from "@/lib/githubApi";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";

const MODEL_STORAGE_KEY = "unt_model_settings_v1";
const GITHUB_WORKSPACE_KEY = "unt_github_workspace_v1";
/** Legacy single-session key — migrated on first load */
const LEGACY_MESSAGES_KEY = "unt_chat_messages_v1";
const CHAT_SESSIONS_KEY = "unt_chat_sessions_v2";
const USER_ALGOS_KEY = "unt_user_algo_presets_v1";
const TRADING_MODE_STORAGE_KEY = "unt_trading_mode_v1";
const SELECTED_ALGO_KEY = "unt_selected_algo_v1";
const CA_MINT_KEY = "unt_ca_mint_v1";
const SCALPER_LIVE_BUY_SOL_KEY = "unt_scalper_live_buy_sol_v1";
const SCALPER_LIVE_BUY_MIN = 0.001;
const SCALPER_LIVE_BUY_MAX = 25;
const MAX_STORED_MESSAGES = 120;
const MAX_SESSIONS = 10;

export type TradingMode = "paper" | "real";

function loadTradingMode(): TradingMode {
  try {
    const raw = localStorage.getItem(TRADING_MODE_STORAGE_KEY);
    if (raw === "real" || raw === "paper") return raw;
    return "paper";
  } catch {
    return "paper";
  }
}

export const defaultModel: ModelSettings = {
  providerLabel: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  llmBackendId: "openai",
};

function loadModel(): ModelSettings {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return defaultModel;
    const parsed = { ...defaultModel, ...JSON.parse(raw) } as ModelSettings;
    if (!parsed.llmBackendId) {
      const fromUrl = inferBackendIdFromBaseUrl(parsed.baseUrl);
      if (fromUrl) parsed.llmBackendId = fromUrl;
    }
    return parsed;
  } catch {
    return defaultModel;
  }
}

function makeGreetingSession(id?: string, name?: string): ChatSession {
  return {
    id: id ?? crypto.randomUUID(),
    name: name ?? "Chat 1",
    messages: [createAssistantGreetingMessage()],
    createdAt: Date.now(),
  };
}


function loadUserAlgos(): UserAlgoPreset[] {
  try {
    const raw = localStorage.getItem(USER_ALGOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UserAlgoPreset[];
  } catch {
    return [];
  }
}

const defaultGithubWorkspace: GitHubWorkspaceSettings = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
};

function loadSelectedAlgoId(): string | null {
  try {
    return localStorage.getItem(SELECTED_ALGO_KEY) ?? null;
  } catch {
    return null;
  }
}

function loadCaMintInput(): string {
  try {
    return localStorage.getItem(CA_MINT_KEY) ?? "";
  } catch {
    return "";
  }
}

function clampScalperLiveBuySol(n: number): number {
  if (!Number.isFinite(n)) return SCALPER_PAPER_CONFIG.realBuySol;
  return Math.min(SCALPER_LIVE_BUY_MAX, Math.max(SCALPER_LIVE_BUY_MIN, n));
}

function loadScalperLiveBuySol(): number {
  try {
    const raw = localStorage.getItem(SCALPER_LIVE_BUY_SOL_KEY);
    if (!raw) return SCALPER_PAPER_CONFIG.realBuySol;
    return clampScalperLiveBuySol(Number(raw));
  } catch {
    return SCALPER_PAPER_CONFIG.realBuySol;
  }
}

function loadGithubWorkspace(): GitHubWorkspaceSettings {
  try {
    const raw = localStorage.getItem(GITHUB_WORKSPACE_KEY);
    if (!raw) return { ...defaultGithubWorkspace };
    return { ...defaultGithubWorkspace, ...JSON.parse(raw) } as GitHubWorkspaceSettings;
  } catch {
    return { ...defaultGithubWorkspace };
  }
}

export type ActivitySection = "analytics" | "models" | "code";
export type SidebarMode = "analytics" | "models" | "code";

/** Live chart + PumpPortal order-book stream signals for the Dashboard sidebar (chart panel). */
/** Last closed candle as shown on chart (OHLC). Values are price USD or MC USD depending on axis mode. */
export type ChartCandleBarSummary = {
  interval: string;
  timeUnix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  yAxisIsMarketCapUsd: boolean;
};

export type ChartTapePrintLite = {
  ts: number;
  buy: boolean;
  sol: number;
  mcUsd: number | null;
};

/** Aggregate view of buffered PumpPortal prints (newest-first buffer). */
export type ChartTapeSummary = {
  sampleSize: number;
  buyCount: number;
  sellCount: number;
  solVolume: number;
  /** Best available MC from recent prints (usually newest trade’s MC). */
  latestMcUsd: number | null;
  recentPrints: ChartTapePrintLite[];
};

export type ChartAnalyticsState = {
  mint: string | null;
  chartLoading: boolean;
  chartError: string | null;
  yMcCap: boolean | null;
  /** Candle interval when a mint is active */
  chartInterval: string | null;
  lastCandle: ChartCandleBarSummary | null;
  tapeSummary: ChartTapeSummary | null;
  /** SPL token supply (UI units) when RPC returned it — used for MC scaling context */
  tokenSupplyUi: number | null;
  orderBookConn: "idle" | "connecting" | "open" | "closed" | "error";
  orderBookError: string | null;
  /** Paper Scalper sim fed by the order-book stream (chart panel); null when inactive. */
  paperScalper: ScalperPaperSnapshot | null;
  /** Closed round-trips from real execution (reserved for future local-signing path). */
  realBotTrades: BotTradeRow[];
  /** Last PumpPortal Lightning tx signature from live scalper (browser → PumpPortal). */
  livePumpPortalLastSig: string | null;
  /** Last live trade error message from PumpPortal. */
  livePumpPortalLastErr: string | null;
};

const defaultChartAnalytics: ChartAnalyticsState = {
  mint: null,
  chartLoading: false,
  chartError: null,
  yMcCap: null,
  chartInterval: null,
  lastCandle: null,
  tapeSummary: null,
  tokenSupplyUi: null,
  orderBookConn: "idle",
  orderBookError: null,
  paperScalper: null,
  realBotTrades: [],
  livePumpPortalLastSig: null,
  livePumpPortalLastErr: null,
};

type AppState = {
  model: ModelSettings;
  setModel: (m: Partial<ModelSettings>) => void;

  /** All chat sessions */
  chatSessions: ChatSession[];
  activeChatId: string;
  setActiveChatId: (id: string) => void;
  newChatSession: () => void;
  closeChatSession: (id: string) => void;
  renameChatSession: (id: string, name: string) => void;
  setSessionModel: (id: string, patch: Partial<ModelSettings>) => void;
  clearSessionModel: (id: string) => void;

  /** Convenience: messages of the active session */
  messages: ChatMessage[];
  appendMessage: (m: Omit<ChatMessage, "id" | "createdAt">) => string;
  updateMessage: (id: string, patch: Partial<Pick<ChatMessage, "content">>) => void;
  clearChat: () => void;

  /** Opens the Setup sidebar (models / keys). */
  openSetupPanel: () => void;

  /**
   * Put this mint in the Chart panel input and focus Dashboard (user still triggers fetch via debounce).
   */
  navigateChartToMint: (mint: string) => void;

  chartAnalytics: ChartAnalyticsState;
  setChartAnalytics: (patch: Partial<ChartAnalyticsState>) => void;
  composerBusy: boolean;
  setComposerBusy: (v: boolean) => void;
  sidebarMode: SidebarMode;
  setSidebarMode: (m: SidebarMode) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  activitySection: ActivitySection;
  setActivitySection: (s: ActivitySection) => void;
  userAlgos: UserAlgoPreset[];
  addUserAlgo: (name: string, description: string) => void;
  removeUserAlgo: (id: string) => void;
  selectedAlgoId: string | null;
  setSelectedAlgoId: (id: string | null) => void;
  caMintInput: string;
  setCaMintInput: (v: string) => void;
  /** SOL per Lightning buy when Order-book scalper is in real mode (clamped). */
  scalperLiveBuySol: number;
  setScalperLiveBuySol: (v: number) => void;
  tradingMode: TradingMode;
  setTradingMode: (m: TradingMode) => void;
  algoSessionActive: boolean;
  setAlgoSessionActive: (v: boolean) => void;
  /** When true, live PumpPortal sends are blocked until cleared (e.g. new session). */
  tradingHalted: boolean;
  setTradingHalted: (v: boolean) => void;
  /** Emergency stop: halt live sends + end scalper session. */
  hardStopTrading: () => void;
  githubWorkspace: GitHubWorkspaceSettings;
  setGithubWorkspace: (patch: Partial<GitHubWorkspaceSettings>) => void;
  openFilePath: string | null;
  openFileContent: string | null;
  setOpenFile: (path: string | null, content: string | null) => void;
  workspaceFilePaths: string[];
  setWorkspaceFilePaths: (paths: string[]) => void;
  applyEditTick: number;
  lastAppliedPath: string | null;
  /**
   * Apply a file edit from chat. Auto-detects create vs update.
   * Returns the GitHub commit SHA.
   */
  applyFileEdit: (path: string, code: string, commitMessage?: string) => Promise<string>;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [model, setModelState] = useState(loadModel);

  // Chat sessions intentionally NOT loaded from localStorage — always start fresh.
  const [sessionsState, setSessionsState] = useState(() => {
    const s = makeGreetingSession();
    return { sessions: [s], activeId: s.id };
  });
  const chatSessions = sessionsState.sessions;
  const activeChatId = sessionsState.activeId;

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("analytics");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activitySection, setActivitySection] = useState<ActivitySection>("analytics");
  const [chartAnalytics, setChartAnalyticsState] = useState<ChartAnalyticsState>(defaultChartAnalytics);
  const [composerBusy, setComposerBusy] = useState(false);
  const [userAlgos, setUserAlgos] = useState(loadUserAlgos);
  const [selectedAlgoId, setSelectedAlgoId] = useState<string | null>(loadSelectedAlgoId);
  const [caMintInput, setCaMintInput] = useState(loadCaMintInput);
  const [scalperLiveBuySol, setScalperLiveBuySolState] = useState(loadScalperLiveBuySol);
  const [tradingMode, setTradingModeState] = useState<TradingMode>(loadTradingMode);
  const [algoSessionActive, setAlgoSessionActive] = useState(false);
  const [tradingHalted, setTradingHalted] = useState(false);
  const [githubWorkspace, setGithubWorkspaceState] = useState(loadGithubWorkspace);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  const [workspaceFilePaths, setWorkspaceFilePaths] = useState<string[]>([]);
  const [applyEditTick, setApplyEditTick] = useState(0);
  const [lastAppliedPath, setLastAppliedPath] = useState<string | null>(null);

  // ── Persist other settings ────────────────────────────────────────
  function lsSave(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* QuotaExceededError — silently ignore */ }
  }

  // Chat sessions are intentionally NOT persisted — every load starts fresh.
  // Purge any stale chat data left from a previous build.
  useEffect(() => {
    try {
      localStorage.removeItem(CHAT_SESSIONS_KEY);
      localStorage.removeItem(LEGACY_MESSAGES_KEY);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    lsSave(MODEL_STORAGE_KEY, JSON.stringify(model));
  }, [model]);

  useEffect(() => {
    lsSave(USER_ALGOS_KEY, JSON.stringify(userAlgos));
  }, [userAlgos]);

  useEffect(() => {
    lsSave(TRADING_MODE_STORAGE_KEY, tradingMode);
  }, [tradingMode]);

  useEffect(() => {
    if (selectedAlgoId) lsSave(SELECTED_ALGO_KEY, selectedAlgoId);
    else localStorage.removeItem(SELECTED_ALGO_KEY);
  }, [selectedAlgoId]);

  useEffect(() => {
    if (caMintInput) lsSave(CA_MINT_KEY, caMintInput);
    else localStorage.removeItem(CA_MINT_KEY);
  }, [caMintInput]);

  useEffect(() => {
    lsSave(SCALPER_LIVE_BUY_SOL_KEY, String(scalperLiveBuySol));
  }, [scalperLiveBuySol]);

  useEffect(() => {
    lsSave(GITHUB_WORKSPACE_KEY, JSON.stringify(githubWorkspace));
  }, [githubWorkspace]);

  // ── Session helpers ───────────────────────────────────────────────
  const updateSessions = useCallback(
    (fn: (prev: ChatSession[]) => ChatSession[]) => {
      setSessionsState((s) => ({ ...s, sessions: fn(s.sessions) }));
    },
    [],
  );

  const setActiveChatId = useCallback((id: string) => {
    setSessionsState((s) => ({ ...s, activeId: id }));
  }, []);

  const newChatSession = useCallback(() => {
    setSessionsState((prev) => {
      const s = makeGreetingSession();
      s.name = `Chat ${prev.sessions.length + 1}`;
      return {
        sessions: [...prev.sessions.slice(-(MAX_SESSIONS - 1)), s],
        activeId: s.id,
      };
    });
  }, []);

  const closeChatSession = useCallback((id: string) => {
    setSessionsState((prev) => {
      const next = prev.sessions.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = makeGreetingSession();
        return { sessions: [fresh], activeId: fresh.id };
      }
      const activeId = prev.activeId === id ? next[next.length - 1]!.id : prev.activeId;
      return { sessions: next, activeId };
    });
  }, []);

  const renameChatSession = useCallback((id: string, name: string) => {
    updateSessions((ss) => ss.map((s) => (s.id === id ? { ...s, name: name.slice(0, 36) } : s)));
  }, [updateSessions]);

  const setSessionModel = useCallback((id: string, patch: Partial<ModelSettings>) => {
    updateSessions((ss) =>
      ss.map((s) =>
        s.id === id
          ? { ...s, modelOverride: { ...s.modelOverride, ...patch } }
          : s,
      ),
    );
  }, [updateSessions]);

  const clearSessionModel = useCallback((id: string) => {
    updateSessions((ss) =>
      ss.map((s) => (s.id === id ? { ...s, modelOverride: undefined } : s)),
    );
  }, [updateSessions]);

  // ── Active session messages ───────────────────────────────────────
  const messages = useMemo(
    () => chatSessions.find((s) => s.id === activeChatId)?.messages ?? [],
    [chatSessions, activeChatId],
  );

  const appendMessage = useCallback(
    (m: Omit<ChatMessage, "id" | "createdAt">): string => {
      const id = crypto.randomUUID();
      const full: ChatMessage = { ...m, id, createdAt: Date.now() };
      updateSessions((ss) =>
        ss.map((s) => {
          if (s.id !== activeChatId) return s;
          const newMessages = [...s.messages, full].slice(-MAX_STORED_MESSAGES);
          // Auto-name session from first user message
          const name =
            s.name.startsWith("Chat ") && m.role === "user" && s.messages.filter((x) => x.role === "user").length === 0
              ? m.content.slice(0, 36).replace(/\n/g, " ") || s.name
              : s.name;
          return { ...s, name, messages: newMessages };
        }),
      );
      return id;
    },
    [activeChatId, updateSessions],
  );

  const updateMessage = useCallback(
    (id: string, patch: Partial<Pick<ChatMessage, "content">>) => {
      updateSessions((ss) =>
        ss.map((s) =>
          s.id !== activeChatId
            ? s
            : {
                ...s,
                messages: s.messages.map((msg) =>
                  msg.id === id ? { ...msg, ...patch } : msg,
                ),
              },
        ),
      );
    },
    [activeChatId, updateSessions],
  );

  const clearChat = useCallback(() => {
    updateSessions((ss) =>
      ss.map((s) =>
        s.id === activeChatId
          ? { ...s, messages: [createAssistantGreetingMessage()] }
          : s,
      ),
    );
  }, [activeChatId, updateSessions]);

  // ── Other setters ─────────────────────────────────────────────────
  const openSetupPanel = useCallback(() => {
    setSidebarOpen(true);
    setSidebarMode("models");
    setActivitySection("models");
  }, []);

  const navigateChartToMint = useCallback((mint: string) => {
    const m = mint.trim();
    if (!m) return;
    setCaMintInput(m);
    setSidebarOpen(true);
    setSidebarMode("analytics");
    setActivitySection("analytics");
  }, []);

  const setModel = useCallback((patch: Partial<ModelSettings>) => {
    setModelState((m) => ({ ...m, ...patch }));
  }, []);

  const setOpenFile = useCallback((path: string | null, content: string | null) => {
    setOpenFilePath(path);
    setOpenFileContent(content);
  }, []);

  const setGithubWorkspace = useCallback((patch: Partial<GitHubWorkspaceSettings>) => {
    setGithubWorkspaceState((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyFileEdit = useCallback(
    async (path: string, code: string, commitMessage?: string): Promise<string> => {
      const { token, owner, repo, branch } = githubWorkspace;
      if (!token.trim() || !owner.trim() || !repo.trim()) {
        throw new Error("Connect your GitHub repo in Setup first (PAT + Fork & connect).");
      }
      const br = branch.trim() || "main";

      // Try to fetch SHA; if 404, this is a new file (no SHA needed)
      let existingSha: string | undefined;
      try {
        const { sha } = await githubGetFileContent(token, owner, repo, br, path);
        existingSha = sha;
      } catch {
        existingSha = undefined;
      }

      const { commitSha } = await githubPutFileContent({
        token,
        owner,
        repo,
        branch: br,
        path,
        message: commitMessage ?? `${existingSha ? "Edit" : "Create"} ${path} via chat`,
        contentUtf8: code,
        sha: existingSha,
      });

      setLastAppliedPath(path);
      setApplyEditTick((t) => t + 1);
      return commitSha;
    },
    [githubWorkspace],
  );

  const setTradingMode = useCallback((m: TradingMode) => {
    setTradingModeState(m);
  }, []);

  const setScalperLiveBuySol = useCallback((v: number) => {
    setScalperLiveBuySolState(clampScalperLiveBuySol(v));
  }, []);

  const hardStopTrading = useCallback(() => {
    setTradingHalted(true);
    setAlgoSessionActive(false);
  }, []);

  const setChartAnalytics = useCallback((patch: Partial<ChartAnalyticsState>) => {
    setChartAnalyticsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const addUserAlgo = useCallback((name: string, description: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const next: UserAlgoPreset = {
      id: crypto.randomUUID(),
      name: trimmedName,
      description: description.trim() || "No description",
      createdAt: Date.now(),
    };
    setUserAlgos((prev) => [next, ...prev]);
    setSelectedAlgoId(next.id);
  }, []);

  const removeUserAlgo = useCallback((id: string) => {
    setUserAlgos((prev) => prev.filter((a) => a.id !== id));
    setSelectedAlgoId((cur) => (cur === id ? null : cur));
  }, []);

  const value = useMemo(
    () => ({
      model,
      setModel,
      chatSessions,
      activeChatId,
      setActiveChatId,
      newChatSession,
      closeChatSession,
      renameChatSession,
      setSessionModel,
      clearSessionModel,
      messages,
      appendMessage,
      updateMessage,
      clearChat,
      openSetupPanel,
      navigateChartToMint,
      chartAnalytics,
      setChartAnalytics,
      composerBusy,
      setComposerBusy,
      sidebarMode,
      setSidebarMode,
      sidebarOpen,
      setSidebarOpen,
      activitySection,
      setActivitySection,
      userAlgos,
      addUserAlgo,
      removeUserAlgo,
      selectedAlgoId,
      setSelectedAlgoId,
      caMintInput,
      setCaMintInput,
      scalperLiveBuySol,
      setScalperLiveBuySol,
      tradingMode,
      setTradingMode,
      algoSessionActive,
      setAlgoSessionActive,
      tradingHalted,
      setTradingHalted,
      hardStopTrading,
      githubWorkspace,
      setGithubWorkspace,
      openFilePath,
      openFileContent,
      setOpenFile,
      workspaceFilePaths,
      setWorkspaceFilePaths,
      applyEditTick,
      lastAppliedPath,
      applyFileEdit,
    }),
    [
      model, setModel,
      chatSessions, activeChatId, setActiveChatId, newChatSession, closeChatSession,
      renameChatSession, setSessionModel, clearSessionModel,
      messages, appendMessage, updateMessage, clearChat, openSetupPanel, navigateChartToMint,
      chartAnalytics, setChartAnalytics,
      composerBusy,
      sidebarMode, sidebarOpen, activitySection,
      userAlgos, addUserAlgo, removeUserAlgo, selectedAlgoId,
      caMintInput, scalperLiveBuySol, tradingMode, algoSessionActive, tradingHalted,
      githubWorkspace, setGithubWorkspace,
      openFilePath, openFileContent, setOpenFile,
      workspaceFilePaths, setWorkspaceFilePaths,
      applyEditTick, lastAppliedPath, applyFileEdit,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp requires AppProvider");
  return v;
}

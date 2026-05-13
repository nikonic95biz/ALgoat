export type ChatRole = "user" | "assistant" | "system";

/** An independent chat conversation with its own message history and optional model override. */
export type ChatSession = {
  id: string;
  /** Auto-set from the first user message (first 36 chars). */
  name: string;
  messages: ChatMessage[];
  /** When set, overrides the global model for this session only. */
  modelOverride?: Partial<ModelSettings>;
  createdAt: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
};

export type ModelSettings = {
  providerLabel: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Persisted backend row id from `lib/llmBackends` (Setup UI). */
  llmBackendId?: string;
};

/** Middle workspace editor tab (label is placeholder until product naming). */
export type WorkspaceTab = {
  id: string;
  label: string;
};

/** Default tabs — Chart vs Nursery alternate views of live activity. */
export const DEFAULT_WORKSPACE_TABS: WorkspaceTab[] = [
  { id: "unt-ws-chart", label: "Chart" },
  { id: "unt-ws-blocks", label: "Nursery" },
];

/** First tab id — used as fallback for persisted active tab. */
export const FALLBACK_WORKSPACE_TAB_ID = DEFAULT_WORKSPACE_TABS[0]!.id;

/** User-saved algo preset (sidebar). */
export type UserAlgoPreset = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  strategyId?: string;
  config?: {
    dipMinPct: number;
    catalystMinSol: number;
    takeProfitPct: number;
    minOrderBookSellSolForStop: number;
    realSlippagePct: number;
    realPriorityFeeSol: number;
    reentryCooldownMs: number;
  };
  source?: "manual" | "chat" | "training" | "default";
  stats?: {
    testedSessions: number;
    avgPnlPct: number;
    winRate: number | null;
    lastTrainedAt: number;
  };
};

export type AlgoBlueprintStatus = "draft" | "training" | "paper-ready" | "live-ready";

export type AlgoBlueprint = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: AlgoBlueprintStatus;
  goal: string;
  universe: string[];
  signals: string[];
  entryRules: string[];
  exitRules: string[];
  riskRules: string[];
  knobs: Array<{
    key: string;
    label: string;
    value: number | string | boolean;
    unit?: string;
  }>;
  training: {
    datasets: string[];
    sessions: string[];
    notes: string;
  };
  performance: {
    sessions: string[];
    winRate: number | null;
    pnl: number | null;
    lastTestedAt: number | null;
  };
  implementation: {
    strategyId: string | null;
    presetId: string | null;
    sourceFiles: string[];
    runnable: boolean;
  };
};

export type TrainingSession = {
  id: string;
  name: string;
  strategyId: string;
  presetId: string;
  presetName: string;
  mint: string | null;
  createdAt: number;
  dataSource: "current_tape";
  sampleSize: number;
  configSnapshot: NonNullable<UserAlgoPreset["config"]>;
  result: {
    totalPnlPct: number;
    winRate: number | null;
    closedTrades: number;
    buyCount: number;
    sellCount: number;
    solVolume: number;
    latestMcUsd: number | null;
    bestPnlPct: number | null;
    worstPnlPct: number | null;
  };
};

export type TradingSessionRecord = {
  id: string;
  name: string;
  createdAt: number;
  endedAt?: number;
  mode: "paper" | "real";
  strategyId: string;
  presetId: string;
  presetName: string;
  mint: string | null;
  walletPk: string | null;
  status: "running" | "stopped";
  configSnapshot: NonNullable<UserAlgoPreset["config"]>;
  liveBuySol: number;
  startSnapshot: {
    tapeSampleSize: number;
    latestMcUsd: number | null;
    orderBookConn: string;
    orderBookLastTradeAt: number | null;
  };
  trades: Array<{
    id: string;
    kind: "paper" | "real";
    closedAtTs: number;
    exitReason: string;
    pnlPct: number | null;
    netSol: number | null;
    entryMcUsd?: number;
    exitMcUsd?: number;
  }>;
};

/** Fork workspace: read/write repo files via GitHub REST API (token stays in this browser). */
export type GitHubWorkspaceSettings = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
};

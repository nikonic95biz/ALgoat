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
};

/** Fork workspace: read/write repo files via GitHub REST API (token stays in this browser). */
export type GitHubWorkspaceSettings = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
};

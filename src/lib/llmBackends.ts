export type LlmBackendId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "groq"
  | "google-ai-studio"
  | "mistral"
  | "deepseek"
  | "xai"
  | "perplexity"
  | "together"
  | "ollama";

export type LlmBackendDefinition = {
  id: LlmBackendId;
  /** Short label in Setup provider dropdown */
  label: string;
  providerLabel: string;
  baseUrl: string;
  defaultModel: string;
  staticModels: string[];
  /** GET `{baseUrl}/models` OpenAI-style list */
  fetchModelsList: boolean;
};

export const LLM_BACKENDS: LlmBackendDefinition[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    providerLabel: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    fetchModelsList: true,
    staticModels: [
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
      "anthropic/claude-3.7-sonnet",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      "anthropic/claude-opus-4.7",
      "google/gemini-2.0-flash-001",
      "deepseek/deepseek-r1",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    providerLabel: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    fetchModelsList: true,
    staticModels: [
      "gpt-4o-mini",
      "gpt-4o",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4-turbo",
      "o4-mini",
      "o3-mini",
      "o3",
      "chatgpt-4o-latest",
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    providerLabel: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
    fetchModelsList: false,
    staticModels: [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    providerLabel: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    fetchModelsList: true,
    staticModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "mixtral-8x7b-32768",
    ],
  },
  {
    id: "google-ai-studio",
    label: "Google AI Studio",
    providerLabel: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    fetchModelsList: true,
    staticModels: ["gemini-2.0-flash", "gemini-1.5-pro"],
  },
  {
    id: "mistral",
    label: "Mistral",
    providerLabel: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    fetchModelsList: true,
    staticModels: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    providerLabel: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    fetchModelsList: true,
    staticModels: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    providerLabel: "xAI",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-code-fast-1",
    fetchModelsList: true,
    staticModels: [
      "grok-code-fast-1",
      "grok-4.3",
      "grok-3-mini",
      "grok-2-latest",
    ],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    providerLabel: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar",
    fetchModelsList: false,
    staticModels: ["sonar", "sonar-pro"],
  },
  {
    id: "together",
    label: "Together AI",
    providerLabel: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    fetchModelsList: true,
    staticModels: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    providerLabel: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.2",
    fetchModelsList: true,
    staticModels: ["llama3.2", "llama3.1", "mistral", "qwen2.5"],
  },
];

const BACKEND_BY_ID = Object.fromEntries(LLM_BACKENDS.map((b) => [b.id, b])) as Record<
  LlmBackendId,
  LlmBackendDefinition
>;

export function getLlmBackend(id: LlmBackendId): LlmBackendDefinition {
  return BACKEND_BY_ID[id] ?? LLM_BACKENDS[0]!;
}

export function inferBackendIdFromBaseUrl(baseUrl: string): LlmBackendId | null {
  const hit = LLM_BACKENDS.find((b) => b.baseUrl === baseUrl);
  return hit?.id ?? null;
}

/**
 * Best-effort issuer guess from API key shape. Returns null when ambiguous or unsupported (e.g. Anthropic direct).
 */
export function inferLlmBackendIdFromApiKey(apiKey: string): LlmBackendId | null {
  const t = apiKey.trim();
  if (!t) return null;

  if (/^sk-ant-/i.test(t)) return "anthropic";

  if (t.startsWith("sk-or-v1-")) return "openrouter";
  if (t.startsWith("sk-proj-") || t.startsWith("sk-svcacct-")) return "openai";
  if (t.startsWith("gsk_")) return "groq";
  if (t.startsWith("AIza")) return "google-ai-studio";

  if (/^sk-[a-zA-Z0-9_-]{20,}$/.test(t) && !t.startsWith("sk-or")) {
    return "openai";
  }

  return null;
}

/** Messages API version header required by Anthropic. */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Beta header that enables prompt caching (5-minute ephemeral cache).
 * With caching, identical system prompt + tool definitions across requests
 * cost only 10% of normal input tokens after the first request.
 *
 * This is the single biggest fix for the 30k TPM rate-limit problem in
 * agentic build mode — every tool round reuses the same system+tools.
 *
 * Anthropic-supported as of mid-2024; safe to send on all sonnet/opus models.
 */
export const ANTHROPIC_BETA_PROMPT_CACHING = "prompt-caching-2024-07-31";

/**
 * Convert a plain system string into an Anthropic content-block array with a
 * cache breakpoint at the end. Anthropic caches everything up to and including
 * the marked block, so this caches the entire system prompt.
 */
export function makeCachedSystemBlocks(system: string): Array<{
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}> {
  if (!system) return [];
  return [
    {
      type: "text",
      text: system,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * Mark the LAST tool definition with cache_control. Anthropic treats this as
 * "cache everything up to and including this tool" — so the entire tool array
 * gets cached as one unit.
 */
export function withCachedTools<T extends { name: string }>(tools: readonly T[]): Array<T & { cache_control?: { type: "ephemeral" } }> {
  if (tools.length === 0) return [];
  const arr = tools.map((t) => ({ ...t }));
  // Mark only the final tool with cache_control (this caches the whole list)
  arr[arr.length - 1] = {
    ...arr[arr.length - 1]!,
    cache_control: { type: "ephemeral" },
  } as T & { cache_control: { type: "ephemeral" } };
  return arr;
}

export function isAnthropicMessagesApiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}

export function anthropicMessagesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/messages`;
}

type Turn = { role: string; content: string };

/**
 * Anthropic requires alternating user/assistant turns starting with user.
 * Merge consecutive same-role turns so pasted multi-turn chat still validates.
 */
export function buildAnthropicMessagesBody(opts: {
  model: string;
  system: string;
  history: Turn[];
  stream: boolean;
  maxTokens?: number;
}): Record<string, unknown> {
  const { model, system, history, stream, maxTokens = 8192 } = opts;
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  for (const m of history) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const role = m.role as "user" | "assistant";
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) {
      prev.content += "\n\n" + m.content;
    } else {
      messages.push({ role, content: m.content });
    }
  }

  while (messages.length > 0 && messages[0]!.role === "assistant") {
    messages.shift();
  }

  return {
    model,
    max_tokens: maxTokens,
    stream,
    system,
    messages,
  };
}

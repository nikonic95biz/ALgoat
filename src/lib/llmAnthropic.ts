/** Messages API version header required by Anthropic. */
export const ANTHROPIC_API_VERSION = "2023-06-01";

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

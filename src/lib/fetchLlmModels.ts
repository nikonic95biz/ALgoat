import { isOpenRouterBaseUrl, resolveLlmApiUrl } from "@/lib/llmDevProxy";

const CHAT_MODEL_BLOCK =
  /embedding|embed|tts|whisper|moderation|audio|realtime|transcribe|davinci-instruct|text-search|code-search/i;

function filterLikelyChatModels(ids: string[]): string[] {
  const out = ids.filter((id) => id && !CHAT_MODEL_BLOCK.test(id));
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

/** Merge remote list with static suggestions; cap length for huge catalogs (OpenRouter). */
function mergeModelLists(remote: string[], fallback: string[], max = 220): string[] {
  const merged = filterLikelyChatModels([...remote, ...fallback]);
  return merged.length > max ? merged.slice(0, max) : merged;
}

/**
 * GET `{baseUrl}/models` (OpenAI-compatible). Returns null on failure.
 */
export async function fetchOpenAiCompatibleModelList(
  baseUrl: string,
  apiKey: string,
  staticFallback: string[],
): Promise<string[] | null> {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;

  const listUrl = `${baseUrl.replace(/\/$/, "")}/models`;
  const url = resolveLlmApiUrl(listUrl);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${trimmed}`,
  };

  if (isOpenRouterBaseUrl(baseUrl)) {
    headers.Referer =
      import.meta.env.VITE_OPENROUTER_REFERRER ||
      (typeof window !== "undefined" ? window.location.origin : "") ||
      "http://localhost:5173";
    headers["X-Title"] =
      import.meta.env.VITE_OPENROUTER_APP_TITLE || "Unknown Name Trader";
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? []).map((x) => x.id).filter(Boolean) as string[];
    if (!ids.length) return null;
    return mergeModelLists(ids, staticFallback);
  } catch {
    return null;
  }
}

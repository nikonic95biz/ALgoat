/**
 * Same-origin `/__proxy/llm/*` routing for chat completions (avoids browser CORS to providers).
 *
 * Enabled during `vite` dev (`import.meta.env.DEV`) and for **`vite preview` on localhost** — preview
 * serves a production bundle (`PROD === true`) but the preview server still exposes the LLM proxy.
 * Disabled on real deployments (non-loopback) or when `VITE_DISABLE_LLM_PROXY` is set.
 */
/** Base URL targets OpenRouter’s OpenAI-compatible API (any *.openrouter.ai host). */
export function isOpenRouterBaseUrl(baseUrl: string): boolean {
  try {
    const h = new URL(baseUrl).hostname;
    return h === "openrouter.ai" || h.endsWith(".openrouter.ai");
  } catch {
    return /\bopenrouter\.ai\b/i.test(baseUrl);
  }
}

export function browserLlmProxyEnabled(): boolean {
  if (import.meta.env.VITE_DISABLE_LLM_PROXY === "1") return false;
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export function resolveLlmApiUrl(absoluteUrl: string): string {
  if (!browserLlmProxyEnabled()) {
    return absoluteUrl;
  }
  let u: URL;
  try {
    u = new URL(absoluteUrl);
  } catch {
    return absoluteUrl;
  }

  const prefix = proxyPrefixForHost(u.hostname, u.port);
  if (!prefix) return absoluteUrl;
  return `/__proxy/llm/${prefix}${u.pathname}${u.search}`;
}

export function resolveChatCompletionUrl(baseUrl: string): string {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  return resolveLlmApiUrl(endpoint);
}

function proxyPrefixForHost(hostname: string, port: string): string | null {
  switch (hostname) {
    case "api.openai.com":
      return "openai";
    case "api.anthropic.com":
      return "anthropic";
    case "api.github.com":
      return "github";
    case "api.groq.com":
      return "groq";
    case "openrouter.ai":
    case "www.openrouter.ai":
    case "api.openrouter.ai":
      return "openrouter";
    case "api.together.xyz":
      return "together";
    case "api.mistral.ai":
      return "mistral";
    case "api.deepseek.com":
      return "deepseek";
    case "api.x.ai":
      return "xai";
    case "api.perplexity.ai":
      return "perplexity";
    case "generativelanguage.googleapis.com":
      return "google-ai";
    default:
      break;
  }
  if (hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai")) {
    return "openrouter";
  }
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port === "11434") {
    return "ollama";
  }
  return null;
}

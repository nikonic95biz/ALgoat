/** Local OpenAI-compatible backends (Ollama, etc.) — API key optional. */
export function isLikelyLocalLlm(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return /localhost|127\.0\.0\.1/.test(baseUrl);
  }
}

export function presetAllowsOptionalApiKey(m: { baseUrl: string; model: string }): boolean {
  void m.model;
  return isLikelyLocalLlm(m.baseUrl);
}

/** Keys from console.anthropic.com — not valid as OpenRouter HTTP Bearer tokens. */
export function looksLikeAnthropicConsoleApiKey(key: string): boolean {
  return /^sk-ant-/i.test(key.trim());
}

/** OpenAI dashboard / project keys — wrong issuer for OpenRouter’s API. */
export function looksLikeOpenAiPlatformKey(key: string): boolean {
  const t = key.trim();
  return t.startsWith("sk-proj-") || t.startsWith("sk-svcacct-");
}

/**
 * If non-null, the user pasted a known *other* provider’s key while an OpenRouter-backed preset is selected.
 */
export function wrongProviderKeyForOpenRouterHint(trimmedKey: string): string | null {
  if (looksLikeAnthropicConsoleApiKey(trimmedKey)) {
    return (
      "That key is from Anthropic’s console (sk-ant-…). OpenRouter expects an OpenRouter key. In Setup, switch API provider to Anthropic (Claude) to use this key, or stay on OpenRouter and paste a key from https://openrouter.ai/keys ."
    );
  }
  if (looksLikeOpenAiPlatformKey(trimmedKey)) {
    return (
      "That looks like an OpenAI platform key (sk-proj-… / sk-svcacct-…). " +
      "OpenRouter-backed presets need a key issued by OpenRouter at https://openrouter.ai/keys ."
    );
  }
  return null;
}

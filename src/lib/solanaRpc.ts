/**
 * Shared Solana JSON-RPC URL (chart supply, native balances).
 *
 * The default is `/sol-rpc` — a same-origin path that:
 *   - On localhost: Vite dev server proxies to api.mainnet-beta.solana.com
 *   - On Vercel:    rewrite rule proxies to api.mainnet-beta.solana.com
 * This avoids CORS issues that public RPCs have with browser origins.
 *
 * Override via `VITE_SOLANA_RPC_URL` for self-hosters with a paid RPC (Helius, Triton, etc.)
 */

const LS_RPC_URL = "unt_solana_rpc_url_v1";

export function getStoredSolanaRpcUrl(): string {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(LS_RPC_URL)?.trim() ?? ""; } catch { return ""; }
}

export function setStoredSolanaRpcUrl(url: string): void {
  if (typeof window === "undefined") return;
  try {
    const u = url.trim();
    if (u) localStorage.setItem(LS_RPC_URL, u);
    else localStorage.removeItem(LS_RPC_URL);
  } catch { /* ignore */ }
}

export function getSolanaRpcUrl(): string {
  const stored = getStoredSolanaRpcUrl();
  if (stored.startsWith("http")) return stored;
  const u = import.meta.env?.VITE_SOLANA_RPC_URL;
  if (typeof u === "string" && u.startsWith("http")) return u;
  return "/sol-rpc";
}

/** POST a JSON-RPC body to the configured Solana RPC. */
export async function fetchSolanaRpc(body: Record<string, unknown>): Promise<Response> {
  const url = getSolanaRpcUrl();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** Shared Solana JSON-RPC URL (chart supply, native balances). */

const PUBLIC_RPC_FALLBACKS = [
  "https://solana-mainnet.g.alchemy.com/v2/demo",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];

export function getSolanaRpcUrl(): string {
  const u = import.meta.env?.VITE_SOLANA_RPC_URL;
  if (typeof u === "string" && u.startsWith("http")) return u;
  return PUBLIC_RPC_FALLBACKS[0]!;
}

/** Try each fallback in order, returning the first successful JSON-RPC response. */
export async function fetchSolanaRpc(body: Record<string, unknown>): Promise<Response> {
  const custom = import.meta.env?.VITE_SOLANA_RPC_URL;
  const urls = typeof custom === "string" && custom.startsWith("http")
    ? [custom]
    : PUBLIC_RPC_FALLBACKS;

  let lastErr: unknown;
  for (const url of urls) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 6000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (res.ok) return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("All Solana RPC endpoints failed");
}

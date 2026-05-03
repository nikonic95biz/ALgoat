/** SPL mint `getTokenSupply` → human token amount (RPC `uiAmount`). */

import { getSolanaRpcUrl } from "@/lib/solanaRpc";

type RpcSupplyResult = {
  jsonrpc: string;
  id: number;
  result?: {
    value?: {
      amount: string;
      decimals: number;
      uiAmount?: number;
      uiAmountString?: string;
    };
  };
};

/**
 * Returns SPL minted supply in **UI units** (not raw lamports).
 * Used so MC ≈ Pump `currency=USD` per-token candle close × supply (matches Dex/Axiom, not × 1e9).
 */
export async function fetchTokenUiSupply(mint: string): Promise<number | null> {
  const m = mint.trim();
  if (!m) return null;
  try {
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), 8000);
    const res = await fetch(getSolanaRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [m],
      }),
      signal: ac.signal,
    });
    window.clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as RpcSupplyResult & { error?: unknown };
    if (data.error != null) return null;
    const v = data.result?.value;
    if (!v) return null;
    const decimals = typeof v.decimals === "number" ? v.decimals : 0;
    if (
      typeof v.uiAmount === "number" &&
      Number.isFinite(v.uiAmount) &&
      v.uiAmount > 0
    ) {
      return v.uiAmount;
    }
    if (typeof v.uiAmountString === "string") {
      const n = Number.parseFloat(v.uiAmountString);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const raw = Number.parseFloat(v.amount);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw / 10 ** decimals;
  } catch {
    return null;
  }
}

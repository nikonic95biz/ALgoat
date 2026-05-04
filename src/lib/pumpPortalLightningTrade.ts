/**
 * PumpPortal Lightning Transaction API — trades execute from the SOL wallet linked to your API key.
 * See https://pumpportal.fun/trading-api/ — `pool`: pump (bonding), pump-amm / raydium (post-graduation), auto.
 */

import { fetchSolanaRpc } from "./solanaRpc";

export type PumpPortalLightningTradeBody = {
  action: "buy" | "sell";
  mint: string;
  /** SOL amount (buy) or token amount / percent string (sell, e.g. "100%"). */
  amount: number | string;
  denominatedInSol: "true" | "false";
  slippage: number;
  priorityFee: number;
  pool?: string;
  skipPreflight?: "true" | "false";
};

type PostTradeResult =
  | { ok: true; signature: string }
  | { ok: false; message: string };

const TRADE_URL = "https://pumpportal.fun/api/trade";

export async function postPumpPortalLightningTrade(
  apiKey: string,
  body: PumpPortalLightningTradeBody,
): Promise<PostTradeResult> {
  const url = `${TRADE_URL}?api-key=${encodeURIComponent(apiKey.trim())}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Network error calling PumpPortal trade API",
    };
  }

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* plain-text error */
  }

  if (!res.ok) {
    const msg =
      json?.error != null
        ? String(json.error)
        : json?.errors != null
          ? String(json.errors)
          : text.trim().slice(0, 280) || `HTTP ${res.status}`;
    return { ok: false, message: msg };
  }

  const sig =
    json?.signature != null
      ? String(json.signature)
      : json?.txSig != null
        ? String(json.txSig)
        : "";
  if (!sig) {
    return { ok: false, message: text.trim().slice(0, 280) || "No signature in PumpPortal response" };
  }
  return { ok: true, signature: sig };
}

/**
 * Infer venue from PumpPortal prints (newest-first buffer): reserve snapshots ⇒ bonding curve;
 * prolonged absence ⇒ usually migrated (Pump AMM / Raydium).
 */
export type PumpPortalPoolHint = "pump" | "pump-amm" | "auto";

export function inferPumpPortalTradePool(
  rowsNewestFirst: ReadonlyArray<{ bonding: unknown | null }>,
): PumpPortalPoolHint {
  const cap = Math.min(rowsNewestFirst.length, 120);
  if (cap < 4) return "auto";

  let withBonding = 0;
  for (let i = 0; i < cap; i++) {
    if (rowsNewestFirst[i]!.bonding != null) withBonding++;
  }
  const f = withBonding / cap;
  if (f >= 0.14) return "pump";
  if (f <= 0.03) return "pump-amm";
  return "auto";
}

const MIGRATED_ERR_RE =
  /6005|bonding curve has completed|liquidity migrated|migrated to raydium|curve.*completed|pumpswap unavailable on curve/i;

const NEED_CURVE_ERR_RE =
  /must use bonding|bonding.?curve only|still on bonding|not migrated|pre.?bond/i;

export type LightningTradeFallbackResult =
  | { ok: true; signature: string; poolUsed: string }
  | { ok: false; message: string; attempts: string[] };

/**
 * Post trade; if API signals migrated bonding curve (6005 etc.), retries `pump-amm` then `raydium`.
 * Bonding-only errors retry `pump`.
 */
export async function postPumpPortalLightningTradeWithFallback(
  apiKey: string,
  body: PumpPortalLightningTradeBody,
): Promise<LightningTradeFallbackResult> {
  const attempts: string[] = [];
  let lastMsg = "";

  async function tryPool(pool: string): Promise<{ ok: true; signature: string; poolUsed: string } | null> {
    attempts.push(pool);
    const r = await postPumpPortalLightningTrade(apiKey, { ...body, pool });
    if (r.ok) return { ok: true, signature: r.signature, poolUsed: pool };
    lastMsg = r.message;
    return null;
  }

  let ok = await tryPool(body.pool ?? "auto");
  if (ok) return ok;

  const errLow = lastMsg.toLowerCase();
  const looksMigrated = MIGRATED_ERR_RE.test(errLow) || /\b6005\b/.test(lastMsg);

  if (looksMigrated) {
    ok = await tryPool("pump-amm");
    if (ok) return ok;
    ok = await tryPool("raydium");
    if (ok) return ok;
  }

  if (NEED_CURVE_ERR_RE.test(errLow)) {
    ok = await tryPool("pump");
    if (ok) return ok;
  }

  return { ok: false, message: lastMsg, attempts };
}

/**
 * Poll Solana RPC until the tx is confirmed or times out.
 */
export async function confirmLightningTx(
  signature: string,
  timeoutMs = 20_000,
): Promise<{ confirmed: boolean; err: string | null }> {
  const deadline = Date.now() + timeoutMs;
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  while (Date.now() < deadline) {
    try {
      const res = await fetchSolanaRpc({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      });
      const json = (await res.json()) as {
        result?: { value?: Array<{ confirmationStatus?: string; err: unknown } | null> };
      };
      const status = json.result?.value?.[0];
      if (status !== undefined && status !== null) {
        if (status.err !== null && status.err !== undefined) {
          return { confirmed: false, err: `Tx failed on-chain: ${JSON.stringify(status.err)}` };
        }
        const lvl = status.confirmationStatus;
        if (lvl === "confirmed" || lvl === "finalized") {
          return { confirmed: true, err: null };
        }
      }
    } catch {
      // RPC blip — retry
    }
    await delay(1500);
  }
  return { confirmed: false, err: "Tx not confirmed within timeout — check explorer" };
}

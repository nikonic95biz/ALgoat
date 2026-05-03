/**
 * Nursery Engine — four token feeds:
 *   New Pairs       — all pre-bond coins, newest first
 *   About to Grad   — pre-bond sorted by MC desc (closest to graduation)
 *   Bonded          — graduated in last 2 days, newest first
 *   Old Pairs       — graduated >2 days ago, MC still above $9k (hundreds of coins)
 */

import {
  subscribePumpPortalTokenTrades,
  subscribeNewTokens,
} from "@/lib/pumpPortalRealtime";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PreBondToken = {
  mint: string;
  name: string;
  symbol: string;
  firstSeenMs: number;
  lastTradeMs: number;
  marketCapSol: number;
  buys5m: number;
  sells5m: number;
  vol5mSol: number;
  maxSingleBuySol: number;
};

export type BondedToken = {
  mint: string;
  name: string;
  symbol: string;
  bondedMs: number;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  vol1h: number;
  vol24h: number;
  buys1h: number;
  sells1h: number;
  priceChange1h: number;
  priceChange24h: number;
  lastUpdatedMs: number;
  revivalScore: number;
};

export type NurserySnapshot = {
  /** All pre-bond tokens, newest first (New Pairs tab). */
  newPairsList: PreBondToken[];
  /** Pre-bond tokens sorted by MC desc — closest to graduation first. */
  graduatingList: PreBondToken[];
  /** Tokens bonded in last 2 days, newest first. */
  bondedList: BondedToken[];
  /** Tokens bonded >2 days ago still above $9k MC, sorted by revival score. */
  oldPairsList: BondedToken[];
  stats: {
    trackedPrebond: number;
    trackedBonded: number;
    bondedLastRefreshMs: number;
    isRunning: boolean;
  };
};

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOW_5M = 5 * 60_000;
const PREBOND_EVICT_MS = 45 * 60_000;
const MAX_PREBOND = 400;
const MAX_BONDED = 600;                       // track hundreds
const BONDED_MAX_AGE_MS = 30 * 24 * 3600_000; // 30 days lookback for old pairs
const TWO_DAYS_MS = 2 * 24 * 3600_000;
const OLD_PAIRS_MIN_MC_USD = 9_000;
const BONDED_MIN_LIQUIDITY = 500;
const POLL_DEXSCREENER_MS = 120_000;
const BOOTSTRAP_INTERVAL_MS = 90_000;         // re-bootstrap every 90s
const RING_SIZE = 80;
const BONDED_BOOTSTRAP_PAGES = 10;            // 10 × 50 = 500 coins per bootstrap

type TradeEntry = { ts: number; isBuy: boolean; sol: number };

// ── In-memory pools ───────────────────────────────────────────────────────────

const prebondPool = new Map<string, PreBondToken>();
const prebondRings = new Map<string, TradeEntry[]>();
const prebondUnsubs = new Map<string, () => void>();
const bondedPool = new Map<string, BondedToken>();

let running = false;
let newTokenUnsub: (() => void) | null = null;
let bootstrapTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let bondedLastRefreshMs = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function pNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = parseFloat(v); return isFinite(n) ? n : 0; }
  return 0;
}
function pBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1";
  return false;
}

function computeRingStats(ring: TradeEntry[], now: number) {
  const cutoff = now - WINDOW_5M;
  let buys5m = 0, sells5m = 0, vol5mSol = 0, maxSol = 0;
  for (const t of ring) {
    if (t.ts < cutoff) continue;
    if (t.isBuy) buys5m++; else sells5m++;
    vol5mSol += t.sol;
    if (t.sol > maxSol) maxSol = t.sol;
  }
  return { buys5m, sells5m, vol5mSol, maxSol };
}

function computeRevivalScore(t: BondedToken): number {
  if (t.liquidityUsd < BONDED_MIN_LIQUIDITY) return 0;
  if (t.vol24h === 0 && t.lastUpdatedMs === 0) return 0;
  const avgHourly = t.vol24h / 24;
  const volAccel = avgHourly > 0 ? Math.min(t.vol1h / avgHourly, 10) : (t.vol1h > 0 ? 0.5 : 0);
  const totalTxns = t.buys1h + t.sells1h;
  const buyPct = totalTxns > 0 ? t.buys1h / totalTxns : 0.5;
  const recoveryRoom = Math.max(0, Math.min(1, (-t.priceChange24h) / 100));
  const ageDays = (Date.now() - t.bondedMs) / (24 * 3600_000);
  const freshness =
    ageDays < 0.5  ? 0.2 :
    ageDays < 1    ? 0.7 :
    ageDays < 2    ? 1.0 :
    ageDays < 4    ? 0.9 :
    ageDays < 7    ? 0.7 :
    ageDays < 14   ? 0.5 :
    ageDays < 30   ? 0.3 : 0.1;
  return volAccel * buyPct * (0.4 + 0.6 * recoveryRoom) * freshness;
}

function pumpFrontendBase(): string {
  try {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return "/pump-frontend";
  } catch { /* non-browser env */ }
  return "https://frontend-api.pump.fun";
}

// ── Pre-bond lane ─────────────────────────────────────────────────────────────

function handleNewToken(msg: Record<string, unknown>) {
  const mint = pStr(msg.mint ?? msg.coin) ?? "";
  if (!mint || prebondPool.has(mint)) return;
  if (pBool(msg.complete ?? msg.is_complete)) {
    upsertBonded(mint, pStr(msg.name) ?? "?", pStr(msg.symbol) ?? "?");
    return;
  }
  if (prebondPool.size >= MAX_PREBOND) evictDeadPrebond(Date.now());
  if (prebondPool.size >= MAX_PREBOND) return;
  prebondPool.set(mint, {
    mint,
    name: pStr(msg.name) ?? "?",
    symbol: pStr(msg.symbol) ?? "?",
    firstSeenMs: Date.now(),
    lastTradeMs: Date.now(),
    marketCapSol: pNum(msg.marketCapSol ?? msg.market_cap),
    buys5m: 0, sells5m: 0, vol5mSol: 0, maxSingleBuySol: 0,
  });
  prebondRings.set(mint, []);
  const unsub = subscribePumpPortalTokenTrades(mint, (m) => onPrebondTrade(mint, m));
  prebondUnsubs.set(mint, unsub);
}

function onPrebondTrade(mint: string, msg: Record<string, unknown>) {
  const token = prebondPool.get(mint);
  if (!token) return;
  const isBuy = (() => {
    if (typeof msg.isBuy === "boolean") return msg.isBuy;
    if (typeof msg.is_buy === "boolean") return msg.is_buy;
    const tx = String(msg.txType ?? "").toLowerCase();
    return tx === "buy" || tx === "create";
  })();
  const sol = pNum(msg.solAmount ?? msg.sol_amount);
  const mcSol = pNum(msg.marketCapSol ?? msg.market_cap);
  const now = Date.now();
  const ring = prebondRings.get(mint) ?? [];
  ring.push({ ts: now, isBuy, sol });
  if (ring.length > RING_SIZE) ring.shift();
  prebondRings.set(mint, ring);
  const stats = computeRingStats(ring, now);
  token.lastTradeMs = now;
  if (mcSol > 0) token.marketCapSol = mcSol;
  token.buys5m = stats.buys5m;
  token.sells5m = stats.sells5m;
  token.vol5mSol = stats.vol5mSol;
  if (sol > token.maxSingleBuySol) token.maxSingleBuySol = sol;
  if (pBool(msg.complete)) {
    upsertBonded(mint, token.name, token.symbol);
    removePrebond(mint);
  }
}

function removePrebond(mint: string) {
  prebondPool.delete(mint);
  prebondRings.delete(mint);
  const u = prebondUnsubs.get(mint);
  if (u) { u(); prebondUnsubs.delete(mint); }
}

function evictDeadPrebond(now: number) {
  const deadline = now - PREBOND_EVICT_MS;
  for (const [mint, token] of prebondPool) {
    if (token.lastTradeMs < deadline) removePrebond(mint);
  }
}

// ── Bonded lane ───────────────────────────────────────────────────────────────

function upsertBonded(mint: string, name: string, symbol: string) {
  if (!bondedPool.has(mint) && bondedPool.size < MAX_BONDED) {
    bondedPool.set(mint, {
      mint, name, symbol,
      bondedMs: Date.now(),
      priceUsd: 0, marketCapUsd: 0, liquidityUsd: 0,
      vol1h: 0, vol24h: 0, buys1h: 0, sells1h: 0,
      priceChange1h: 0, priceChange24h: 0, lastUpdatedMs: 0, revivalScore: 0,
    });
  }
}

type PumpCoin = {
  mint: string; name: string; symbol: string;
  created_timestamp: number; last_trade_timestamp?: number;
  complete: boolean; usd_market_cap?: number; virtual_sol_reserves?: number;
};

async function bootstrapPrebondCoins() {
  const base = pumpFrontendBase();
  for (let page = 0; page < 4; page++) {
    try {
      const url = `${base}/coins?offset=${page * 50}&limit=50&sort=last_trade_timestamp&order=DESC&complete=false&includeNsfw=false`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) break;
      const coins = (await res.json()) as PumpCoin[];
      if (!Array.isArray(coins) || coins.length === 0) break;
      const now = Date.now();
      let anyRecent = false;
      for (const coin of coins) {
        const lastTradeMs = (coin.last_trade_timestamp ?? 0) * 1000;
        if (now - lastTradeMs > 30 * 60_000) continue;
        anyRecent = true;
        if (!prebondPool.has(coin.mint) && prebondPool.size < MAX_PREBOND) {
          // virtual_sol_reserves is in lamports on the bonding curve; rough MC ≈ reserves / 1e9
          const mcSol = coin.virtual_sol_reserves
            ? coin.virtual_sol_reserves / 1e9
            : (coin.usd_market_cap ?? 0) / 160;
          prebondPool.set(coin.mint, {
            mint: coin.mint, name: coin.name, symbol: coin.symbol,
            firstSeenMs: now, lastTradeMs,
            marketCapSol: mcSol,
            buys5m: 0, sells5m: 0, vol5mSol: 0, maxSingleBuySol: 0,
          });
          prebondRings.set(coin.mint, []);
          if (!prebondUnsubs.has(coin.mint)) {
            const unsub = subscribePumpPortalTokenTrades(coin.mint, (m) => onPrebondTrade(coin.mint, m));
            prebondUnsubs.set(coin.mint, unsub);
          }
        }
      }
      if (!anyRecent) break;
    } catch { break; }
  }
}

async function bootstrapBondedCoins() {
  const base = pumpFrontendBase();
  const cutoff = Date.now() - BONDED_MAX_AGE_MS;

  // Pass 1: newest graduates (sort by created_timestamp DESC — covers "Bonded" tab)
  for (let page = 0; page < BONDED_BOOTSTRAP_PAGES; page++) {
    try {
      const url = `${base}/coins?offset=${page * 50}&limit=50&sort=created_timestamp&order=DESC&complete=true&includeNsfw=false`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) break;
      const coins = (await res.json()) as PumpCoin[];
      if (!Array.isArray(coins) || coins.length === 0) break;
      let anyFresh = false;
      for (const coin of coins) {
        const createdMs = coin.created_timestamp * 1000;
        if (createdMs < cutoff) continue;
        anyFresh = true;
        if (!bondedPool.has(coin.mint) && bondedPool.size < MAX_BONDED) {
          bondedPool.set(coin.mint, {
            mint: coin.mint, name: coin.name, symbol: coin.symbol,
            bondedMs: createdMs,
            priceUsd: 0, marketCapUsd: coin.usd_market_cap ?? 0,
            liquidityUsd: 0, vol1h: 0, vol24h: 0,
            buys1h: 0, sells1h: 0, priceChange1h: 0, priceChange24h: 0,
            lastUpdatedMs: 0, revivalScore: 0,
          });
        }
      }
      if (!anyFresh) break;
    } catch { break; }
  }

  // Pass 2: recently-traded old coins (sort by last_trade_timestamp DESC, complete=true)
  // This surfaces coins that bonded days ago but are showing fresh activity — the zombie play.
  for (let page = 0; page < BONDED_BOOTSTRAP_PAGES; page++) {
    try {
      const url = `${base}/coins?offset=${page * 50}&limit=50&sort=last_trade_timestamp&order=DESC&complete=true&includeNsfw=false`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) break;
      const coins = (await res.json()) as PumpCoin[];
      if (!Array.isArray(coins) || coins.length === 0) break;
      let anyActive = false;
      for (const coin of coins) {
        const lastTradeMs = (coin.last_trade_timestamp ?? 0) * 1000;
        // Stop if we've hit coins that haven't traded in 3 days
        if (Date.now() - lastTradeMs > 3 * 24 * 3600_000) continue;
        anyActive = true;
        const createdMs = coin.created_timestamp * 1000;
        if (!bondedPool.has(coin.mint) && bondedPool.size < MAX_BONDED) {
          bondedPool.set(coin.mint, {
            mint: coin.mint, name: coin.name, symbol: coin.symbol,
            bondedMs: createdMs,
            priceUsd: 0, marketCapUsd: coin.usd_market_cap ?? 0,
            liquidityUsd: 0, vol1h: 0, vol24h: 0,
            buys1h: 0, sells1h: 0, priceChange1h: 0, priceChange24h: 0,
            lastUpdatedMs: 0, revivalScore: 0,
          });
        }
      }
      if (!anyActive) break;
    } catch { break; }
  }
}

type DexPair = {
  chainId: string;
  baseToken?: { address?: string };
  priceUsd?: string;
  volume?: { h1?: number; h24?: number };
  priceChange?: { h1?: number; h24?: number };
  liquidity?: { usd?: number };
  txns?: { h1?: { buys?: number; sells?: number } };
  marketCap?: number;
  fdv?: number;
};

async function pollDexScreener() {
  const mints = [...bondedPool.keys()];
  if (mints.length === 0) return;
  const CHUNK = 30;
  for (let i = 0; i < mints.length; i += CHUNK) {
    const chunk = mints.slice(i, i + CHUNK);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { pairs?: DexPair[] };
      for (const pair of data.pairs ?? []) {
        if (pair.chainId !== "solana") continue;
        const mint = pair.baseToken?.address;
        if (!mint) continue;
        const token = bondedPool.get(mint);
        if (!token) continue;
        token.priceUsd = parseFloat(pair.priceUsd ?? "0") || 0;
        token.marketCapUsd = pair.marketCap ?? pair.fdv ?? token.marketCapUsd;
        token.liquidityUsd = pair.liquidity?.usd ?? 0;
        token.vol1h = pair.volume?.h1 ?? 0;
        token.vol24h = pair.volume?.h24 ?? 0;
        token.buys1h = pair.txns?.h1?.buys ?? 0;
        token.sells1h = pair.txns?.h1?.sells ?? 0;
        token.priceChange1h = pair.priceChange?.h1 ?? 0;
        token.priceChange24h = pair.priceChange?.h24 ?? 0;
        token.lastUpdatedMs = Date.now();
        token.revivalScore = computeRevivalScore(token);
      }
    } catch { /* skip chunk */ }
    if (i + CHUNK < mints.length) await new Promise(r => setTimeout(r, 350));
  }
  bondedLastRefreshMs = Date.now();

  // Evict: keep tokens that are either fresh (<2 days) OR above $9k MC
  // This preserves old pairs worth watching while dropping dead dust
  if (bondedPool.size > MAX_BONDED) {
    const twoDaysAgo = Date.now() - TWO_DAYS_MS;
    const sorted = [...bondedPool.values()]
      .filter(t => t.bondedMs < twoDaysAgo && t.marketCapUsd < OLD_PAIRS_MIN_MC_USD)
      .sort((a, b) => a.revivalScore - b.revivalScore);
    const excess = bondedPool.size - MAX_BONDED;
    for (let i = 0; i < Math.min(excess, sorted.length); i++) {
      bondedPool.delete(sorted[i]!.mint);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getSnapshot(): NurserySnapshot {
  const now = Date.now();
  const twoDaysAgo = now - TWO_DAYS_MS;

  // New Pairs: all pre-bond, newest first
  const newPairsList = [...prebondPool.values()]
    .sort((a, b) => b.firstSeenMs - a.firstSeenMs);

  // About to Graduate: pre-bond sorted by MC desc
  const graduatingList = [...prebondPool.values()]
    .sort((a, b) => b.marketCapSol - a.marketCapSol);

  // Bonded: graduated in last 2 days, newest first
  const bondedList = [...bondedPool.values()]
    .filter(t => t.bondedMs >= twoDaysAgo)
    .sort((a, b) => b.bondedMs - a.bondedMs);

  // Old Pairs: bonded >2 days ago.
  // Before DexScreener has run (lastUpdatedMs === 0) show everything so the list
  // isn't blank. After the first poll, drop tokens that confirmed < $9k MC.
  const dexHasRun = bondedLastRefreshMs > 0;
  const oldPairsList = [...bondedPool.values()]
    .filter(t => {
      if (t.bondedMs >= twoDaysAgo) return false;
      if (!dexHasRun || t.lastUpdatedMs === 0) return true;   // not yet polled
      return t.marketCapUsd >= OLD_PAIRS_MIN_MC_USD;
    })
    .sort((a, b) => b.revivalScore - a.revivalScore || b.bondedMs - a.bondedMs);

  return {
    newPairsList,
    graduatingList,
    bondedList,
    oldPairsList,
    stats: {
      trackedPrebond: prebondPool.size,
      trackedBonded: bondedPool.size,
      bondedLastRefreshMs,
      isRunning: running,
    },
  };
}

export function start() {
  if (running) return;
  running = true;
  newTokenUnsub = subscribeNewTokens(handleNewToken);
  void bootstrapPrebondCoins();
  void bootstrapBondedCoins().then(() => void pollDexScreener());
  bootstrapTimer = setInterval(() => {
    void bootstrapPrebondCoins();
    void bootstrapBondedCoins();
  }, BOOTSTRAP_INTERVAL_MS);
  pollTimer = setInterval(() => {
    evictDeadPrebond(Date.now());
    void pollDexScreener();
  }, POLL_DEXSCREENER_MS);
}

export function stop() {
  running = false;
  newTokenUnsub?.();
  newTokenUnsub = null;
  if (bootstrapTimer) { clearInterval(bootstrapTimer); bootstrapTimer = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  for (const u of prebondUnsubs.values()) u();
  prebondUnsubs.clear();
}

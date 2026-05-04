import type { CandlestickData, UTCTimestamp } from "lightweight-charts";
import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import { fetchTokenUiSupply } from "@/lib/solanaTokenSupply";

// Cache supply per mint so repeated candle polls don't hammer the RPC
const supplyCache = new Map<string, number>();

// ─── In-memory candle cache ───────────────────────────────────────────────────
// Keyed by `${mint}:${interval}`. Holds the full paginated result so switching
// tabs or re-mounting the chart panel doesn't re-fetch the same 10k candles.
type CandleCacheEntry = {
  result: PumpCandlesResult;
  /** Candles beyond this count are "new" after a poll merge. */
  fetchedAt: number;
};
const _candleCache = new Map<string, CandleCacheEntry>();
const CANDLE_CACHE_TTL_MS = 90_000; // 90 s — fresh enough, avoids hammering on fast tab switches

export function getCachedCandles(mint: string, interval: ChartInterval): PumpCandlesResult | null {
  const entry = _candleCache.get(`${mint}:${interval}`);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CANDLE_CACHE_TTL_MS) { _candleCache.delete(`${mint}:${interval}`); return null; }
  return entry.result;
}

export function setCachedCandles(mint: string, interval: ChartInterval, result: PumpCandlesResult): void {
  _candleCache.set(`${mint}:${interval}`, { result, fetchedAt: Date.now() });
}

export function invalidateCandleCache(mint: string, interval: ChartInterval): void {
  _candleCache.delete(`${mint}:${interval}`);
}

/**
 * Resample 1s candles into a larger bucket (e.g. 5 seconds).
 * Used to synthesize intervals not natively supported by the API (e.g. "5s").
 */
export function resampleCandles(
  candles: CandlestickData<UTCTimestamp>[],
  bucketSec: number,
): CandlestickData<UTCTimestamp>[] {
  if (bucketSec <= 1 || candles.length === 0) return candles;
  const buckets = new Map<number, CandlestickData<UTCTimestamp>>();
  for (const c of candles) {
    const bucketTime = (Math.floor((c.time as number) / bucketSec) * bucketSec) as UTCTimestamp;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { time: bucketTime, open: c.open, high: c.high, low: c.low, close: c.close });
    } else {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: existing.open,
        high: Math.max(existing.high, c.high),
        low: Math.min(existing.low, c.low),
        close: c.close,
      });
    }
  }
  return [...buckets.values()].sort((a, b) => (a.time as number) - (b.time as number));
}

/**
 * Merge freshly polled candles into an existing base array.
 * Only the **last two** bars already in `existing` are eligible to be updated by
 * the poll (the current building bar + the one just before it). Every older bar
 * is left untouched — it was correctly loaded on initial fetch, and allowing a
 * periodic poll to re-merge historical bars risks mixing MC multipliers from
 * different RPC calls, which inflates OHLC ranges and creates stretched candles.
 * Bars with timestamps newer than `newestExisting` are always appended.
 */
export function mergeBaseCandles(
  existing: CandlestickData<UTCTimestamp>[],
  incoming: CandlestickData<UTCTimestamp>[],
): CandlestickData<UTCTimestamp>[] {
  if (incoming.length === 0) return existing;
  const map = new Map<number, CandlestickData<UTCTimestamp>>();
  for (const c of existing) map.set(c.time as number, { ...c });

  // Only the last two bars already held are eligible for poll updates
  // (current building bar + the one just before it). Everything older was
  // correctly fetched on initial load — re-merging it risks mixing MC
  // multipliers from different requests, which inflates historical OHLC ranges.
  const newestExisting =
    existing.length > 0 ? (existing[existing.length - 1]!.time as number) : -Infinity;
  const updateThreshold =
    existing.length > 1 ? (existing[existing.length - 2]!.time as number) : newestExisting;

  for (const c of incoming) {
    const t = c.time as number;
    if (t > newestExisting) {
      // Genuinely new bar — always append.
      map.set(t, { ...c });
    } else if (t >= updateThreshold) {
      // Last 1–2 bars: update with freshest data, preserve the historical open.
      const ex = map.get(t);
      if (ex) {
        const open = ex.open;
        const close = c.close;
        const high = Math.max(ex.high, c.high, open, close);
        const low = Math.min(ex.low, c.low, open, close);
        map.set(t, { time: c.time, open, high, low, close });
      } else {
        map.set(t, { ...c });
      }
    }
    // t < updateThreshold → historical, skip entirely.
  }
  return [...map.values()].sort((a, b) => (a.time as number) - (b.time as number));
}

/**
 * Legacy pump UI / PumpPortal MC convention (price × 1e9) when on-chain supply is unavailable.
 * Real MC uses `fetchTokenUiSupply(mint) × spot` to match Axiom/DexScreener (~minted SPL amount).
 */
export const PUMP_BONDING_UI_SUPPLY = 1_000_000_000;

/** Shape returned by swap-api.pump.fun v2 candles (fields may be strings). */
type PumpCandleRow = {
  timestamp?: number;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
};

function num(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function sortRows(rows: PumpCandleRow[]): PumpCandleRow[] {
  return [...rows].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

/**
 * Pump swap-api `currency=USD` is usually **USD per whole token** (not lamports).
 * MC axis = that spot × SPL minted supply. Price ≥ ~10 USD/token → treat as already "coin scale" (no MC axis).
 */
function mcMultiplierFromSortedRows(rows: PumpCandleRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = num(rows[i]?.close);
    if (c !== null && c > 0) {
      return c < 10 ? PUMP_BONDING_UI_SUPPLY : 1;
    }
  }
  return 1;
}

/** Scale PumpPortal `mcUsd` when it assumes FDV at 1B but minted supply is lower (typical on bonding curve). */
export function pumpPortalMcScaleFactor(tokenUiSupply: number | null): number {
  if (
    tokenUiSupply == null ||
    !Number.isFinite(tokenUiSupply) ||
    tokenUiSupply <= 0
  ) {
    return 1;
  }
  return tokenUiSupply / PUMP_BONDING_UI_SUPPLY;
}

async function resolveMcAxisMultiplier(
  mint: string,
  sorted: PumpCandleRow[],
): Promise<{
  mult: number;
  yAxisIsMarketCapUsd: boolean;
  /** SPL `uiAmount` when RPC succeeded; drives chart + PumpPortal MC normalization. */
  tokenUiSupply: number | null;
}> {
  const heuristic = mcMultiplierFromSortedRows(sorted);
  if (heuristic === 1) {
    return { mult: 1, yAxisIsMarketCapUsd: false, tokenUiSupply: null };
  }
  // Supply fetch is best-effort — cache per mint so repeated polls never hit RPC twice
  const cached = supplyCache.get(mint);
  const supply = cached != null
    ? cached
    : await fetchTokenUiSupply(mint).catch(() => null);
  if (supply != null && Number.isFinite(supply) && supply > 0 && supply < 1e15) {
    supplyCache.set(mint, supply);
    return { mult: supply, yAxisIsMarketCapUsd: true, tokenUiSupply: supply };
  }
  return {
    mult: PUMP_BONDING_UI_SUPPLY,
    yAxisIsMarketCapUsd: true,
    tokenUiSupply: null,
  };
}

function toChartRows(
  rows: PumpCandleRow[],
  mult: number,
): CandlestickData<UTCTimestamp>[] {
  const out: CandlestickData<UTCTimestamp>[] = [];
  for (const r of rows) {
    if (r.timestamp === undefined) continue;
    const open = num(r.open);
    const high = num(r.high);
    const low = num(r.low);
    const close = num(r.close);
    if (open === null || high === null || low === null || close === null) continue;
    const sec = Math.floor(r.timestamp / 1000) as UTCTimestamp;
    out.push({
      time: sec,
      open: open * mult,
      high: high * mult,
      low: low * mult,
      close: close * mult,
    });
  }
  out.sort((a, b) => (a.time as number) - (b.time as number));
  return out;
}

function parsePayload(json: unknown): PumpCandleRow[] {
  if (Array.isArray(json)) return json as PumpCandleRow[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const inner = o.candles ?? o.data ?? o.items;
    if (Array.isArray(inner)) return inner as PumpCandleRow[];
  }
  return [];
}

/**
 * Maximum `limit` accepted by swap-api.pump.fun `/candles` (higher values return 400).
 * Larger limits matter most for `1s`, where each row is one bucket.
 */
export const PUMP_CANDLES_MAX_LIMIT = 1000;

/** Supported Pump swap-api `interval` query values (explicit timeframe — no fallback chain). */
export const CHART_INTERVALS = ["1s", "5s", "1m", "5m", "15m"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

const INTERVAL_BUCKET_SEC: Record<ChartInterval, number> = {
  "1s": 1,
  "5s": 5,
  "1m": 60,
  "5m": 300,
  "15m": 900,
};

/** Bar width in seconds for live MC merge — must match the selected chart interval. */
export function chartIntervalBucketSec(interval: ChartInterval): number {
  return INTERVAL_BUCKET_SEC[interval];
}

/** `pumpswap` is not valid on v2 — use `pump_amm` for migrated pools. */
const DEFAULT_PROGRAMS = ["pump", "pump_amm"] as const;

export type PumpCandlesResult = {
  candles: CandlestickData<UTCTimestamp>[];
  /** True when OHLC was scaled to USD market cap (spot × supply). */
  yAxisIsMarketCapUsd: boolean;
  /** Minted SPL supply used as multiplier when RPC worked; null → fell back to 1e9 heuristic. */
  tokenUiSupply: number | null;
  /**
   * Number of raw API candles fetched before any resampling.
   * For resampled intervals (e.g. "5s" synthesised from "1s"), this count is what
   * should be compared against PUMP_CANDLES_MAX_LIMIT for genesis detection, not
   * candles.length (which will be smaller after resampling).
   */
  rawFetchedCount: number;
};

/**
 * Fetches OHLC candles from swap-api.pump.fun.
 *
 * On localhost (`npm run dev` or `vite preview`) the Vite dev server proxies `/pump-api` →
 * `https://swap-api.pump.fun`, so CORS is never an issue there.
 * On a deployed static host the request goes directly to swap-api.pump.fun from the browser.
 * Most deployments work fine; if candles fail on your host add a server-side proxy for
 * `https://swap-api.pump.fun` and set the path prefix via `VITE_PUMP_API_PREFIX`.
 */
export async function fetchPumpCandles(
  mint: string,
  options: {
    interval: ChartInterval;
    limit?: number;
    /**
     * If set, fetch the 1000 bars that end **before** this millisecond timestamp
     * (i.e. older history). Omit or pass 0 to get the latest bars.
     */
    beforeTs?: number;
  },
): Promise<PumpCandlesResult> {
  const id = mint.trim();
  if (!id) throw new Error("Enter a contract address (mint).");

  // "5s" is not a native API interval — synthesize by fetching 1s and resampling.
  // rawFetchedCount carries the 1s count so genesis detection still works correctly
  // (resampled candles.length would be ~1/5 of limit and always appear "genesis").
  if (options.interval === "5s") {
    const result = await fetchPumpCandles(mint, { ...options, interval: "1s" });
    return { ...result, candles: resampleCandles(result.candles, 5), rawFetchedCount: result.rawFetchedCount };
  }

  const { interval } = options;
  const limit = Math.min(
    options.limit ?? PUMP_CANDLES_MAX_LIMIT,
    PUMP_CANDLES_MAX_LIMIT,
  );
  const createdTs =
    options.beforeTs != null && options.beforeTs > 0
      ? String(Math.floor(options.beforeTs))
      : "0";

  // Always use same-origin /pump-api path — on localhost this hits the Vite proxy,
  // on Vercel it hits the rewrite rule that proxies to swap-api.pump.fun.
  // VITE_PUMP_API_PREFIX overrides for self-hosters with a custom proxy.
  const envPrefix = (import.meta.env.VITE_PUMP_API_PREFIX as string | undefined)?.trim();
  const apiPrefix = envPrefix ?? "/pump-api";
  const base = `${apiPrefix}/v2/coins/${encodeURIComponent(id)}/candles`;

  let lastMessage = `No candle data for this mint at ${interval}.`;

  for (const program of DEFAULT_PROGRAMS) {
    const url = new URL(base, window.location.origin);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("currency", "USD");
    url.searchParams.set("createdTs", createdTs);
    url.searchParams.set("program", program);

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });

    if (res.status === 404) {
      lastMessage = "Coin not found or no candles for this mint.";
      continue;
    }
    if (!res.ok) {
      lastMessage = `Pump API error (${res.status}).`;
      continue;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      lastMessage = "Invalid response from Pump API.";
      continue;
    }

    const rawRows = parsePayload(json);
    if (rawRows.length === 0) continue;

    const sorted = sortRows(rawRows);
    const { mult, yAxisIsMarketCapUsd, tokenUiSupply } = await resolveMcAxisMultiplier(
      id,
      sorted,
    );
    const candles = toChartRows(sorted, mult);
    if (candles.length > 0) {
      return { candles, yAxisIsMarketCapUsd, tokenUiSupply, rawFetchedCount: candles.length };
    }
  }

  throw new Error(lastMessage);
}

/**
 * Fetch multiple pages of candles (each capped at {@link PUMP_CANDLES_MAX_LIMIT}) and merge.
 * Uses `createdTs` cursor = oldest raw timestamp − 1 between pages so two requests can cover
 * ~2000 buckets without exceeding per-request limit.
 */
export async function fetchPumpCandlesPaged(
  mint: string,
  options: { interval: ChartInterval; pages?: number; limit?: number },
): Promise<PumpCandlesResult> {
  const id = mint.trim();
  if (!id) throw new Error("Enter a contract address (mint).");

  // "5s" is not a native API interval — synthesize from 1s data.
  if (options.interval === "5s") {
    const result = await fetchPumpCandlesPaged(mint, { ...options, interval: "1s" });
    return { ...result, candles: resampleCandles(result.candles, 5), rawFetchedCount: result.rawFetchedCount };
  }

  const { interval } = options;
  const pages = Math.min(Math.max(options.pages ?? 2, 1), 15);
  const limit = Math.min(
    options.limit ?? PUMP_CANDLES_MAX_LIMIT,
    PUMP_CANDLES_MAX_LIMIT,
  );

  const envPrefix = (import.meta.env.VITE_PUMP_API_PREFIX as string | undefined)?.trim();
  const apiPrefix = envPrefix ?? "/pump-api";
  const base = `${apiPrefix}/v2/coins/${encodeURIComponent(id)}/candles`;
  let lastMessage = `No candle data for this mint at ${interval}.`;

  for (const program of DEFAULT_PROGRAMS) {
    const byTs = new Map<number, PumpCandleRow>();
    let cursorMs = 0;

    for (let page = 0; page < pages; page++) {
      const url = new URL(base, window.location.origin);
      url.searchParams.set("interval", interval);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("currency", "USD");
      url.searchParams.set("createdTs", cursorMs <= 0 ? "0" : String(cursorMs));
      url.searchParams.set("program", program);

      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });

      if (res.status === 404) {
        lastMessage = "Coin not found or no candles for this mint.";
        if (page === 0) byTs.clear();
        break;
      }
      if (!res.ok) {
        lastMessage = `Pump API error (${res.status}).`;
        if (page === 0) byTs.clear();
        break;
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        lastMessage = "Invalid response from Pump API.";
        if (page === 0) byTs.clear();
        break;
      }

      const rawRows = parsePayload(json);
      if (rawRows.length === 0) break;

      let pageMinMs = Infinity;
      for (const row of rawRows) {
        const ts = row.timestamp;
        if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
        byTs.set(ts, row);
        pageMinMs = Math.min(pageMinMs, ts);
      }

      if (!Number.isFinite(pageMinMs)) break;

      cursorMs = Math.floor(pageMinMs) - 1;
      if (rawRows.length < limit) break;
    }

    if (byTs.size === 0) continue;

    const sorted = sortRows([...byTs.values()]);
    const { mult, yAxisIsMarketCapUsd, tokenUiSupply } = await resolveMcAxisMultiplier(
      id,
      sorted,
    );
    const candles = toChartRows(sorted, mult);
    if (candles.length > 0) {
      return { candles, yAxisIsMarketCapUsd, tokenUiSupply, rawFetchedCount: candles.length };
    }
  }

  throw new Error(lastMessage);
}

/**
 * Merge PumpPortal trade prints (USD market cap per tick) on top of swap-api OHLC.
 * Extends the candle tail in real time while periodic REST refresh keeps history aligned.
 */
export function mergeLiveMcUsdIntoCandles(
  base: CandlestickData<UTCTimestamp>[],
  liveRows: PumpPortalLiveRow[],
  bucketSec: number,
): CandlestickData<UTCTimestamp>[] {
  if (liveRows.length === 0) return base;

  const map = new Map<number, CandlestickData<UTCTimestamp>>();
  for (const c of base) {
    map.set(c.time as number, { ...c });
  }

  const sortedLive = [...liveRows]
    .filter((r) => r.mcUsd != null && Number.isFinite(r.mcUsd) && r.mcUsd > 0)
    .sort((a, b) => a.ts - b.ts);

  if (sortedLive.length === 0) return base;

  function prevCloseStrictlyBefore(bucket: number): number | null {
    let bestT = -Infinity;
    let close: number | null = null;
    for (const t of map.keys()) {
      if (t < bucket && t > bestT) {
        bestT = t;
        close = map.get(t)!.close;
      }
    }
    return close;
  }

  for (const r of sortedLive) {
    const tSec = Math.floor(r.ts / 1000);
    const bucket =
      bucketSec <= 1 ? tSec : Math.floor(tSec / bucketSec) * bucketSec;
    const mc = r.mcUsd!;
    const ex = map.get(bucket);
    if (!ex) {
      const pc = prevCloseStrictlyBefore(bucket);
      const open = pc ?? mc;
      map.set(bucket, {
        time: bucket as UTCTimestamp,
        open,
        high: Math.max(open, mc),
        low: Math.min(open, mc),
        close: mc,
      });
    } else {
      map.set(bucket, {
        ...ex,
        high: Math.max(ex.high, mc),
        low: Math.min(ex.low, mc),
        close: mc,
      });
    }
  }

  const out = [...map.values()].sort(
    (a, b) => (a.time as number) - (b.time as number),
  );

  const gapLim = bucketSec <= 1 ? 1.5 : bucketSec * 1.5;
  for (let i = 1; i < out.length; i++) {
    const gap = (out[i].time as number) - (out[i - 1].time as number);
    if (gap <= gapLim) {
      const prev = out[i - 1].close;
      out[i] = {
        ...out[i],
        open: prev,
        high: Math.max(out[i].high, prev),
        low: Math.min(out[i].low, prev),
      };
    }
  }

  return out;
}

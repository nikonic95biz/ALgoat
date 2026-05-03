import type { CandlestickData, UTCTimestamp } from "lightweight-charts";
import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import { fetchTokenUiSupply } from "@/lib/solanaTokenSupply";

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
  // Supply fetch is best-effort — if RPC is unavailable fall back to 1B heuristic silently
  const supply = await fetchTokenUiSupply(mint).catch(() => null);
  if (
    supply != null &&
    Number.isFinite(supply) &&
    supply > 0 &&
    supply < 1e15
  ) {
    return {
      mult: supply,
      yAxisIsMarketCapUsd: true,
      tokenUiSupply: supply,
    };
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
export const CHART_INTERVALS = ["1s", "1m", "5m", "15m"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

const INTERVAL_BUCKET_SEC: Record<ChartInterval, number> = {
  "1s": 1,
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
  options: { interval: ChartInterval; limit?: number },
): Promise<PumpCandlesResult> {
  const id = mint.trim();
  if (!id) throw new Error("Enter a contract address (mint).");

  const { interval } = options;
  const limit = Math.min(
    options.limit ?? PUMP_CANDLES_MAX_LIMIT,
    PUMP_CANDLES_MAX_LIMIT,
  );

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
    url.searchParams.set("createdTs", "0");
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
      return { candles, yAxisIsMarketCapUsd, tokenUiSupply };
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

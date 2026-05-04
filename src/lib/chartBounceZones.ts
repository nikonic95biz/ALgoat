/**
 * Swing / ZigZag-style bounce zones + light memecoin psychology overlay.
 *
 * Pipeline:
 * 1. ZigZag pivots (reversal threshold scaled from median candle noise).
 * 2. Keep swing lows whose dip from **prior local top** ≥ min retrace.
 *    • After first confirmed pivot high → use that high.
 *    • Before that → synthetic peak = **max high only within ~12h lookback** from that low
 *      (avoids “launch high” dominating week-two shelves).
 * 3. **Touches**: count bars whose low is near the pivot (wicks at shelf).
 * 4. **Psychological MC magnets**: if a shelf sits near a round MC ladder, tag `swing+50K`.
 * 5. **Last adjustment**: snap each line to the **minimum candle low** in a ±24h bar window
 *    around the swing pivot (caps ridiculous outliers vs detector price).
 *
 * **Young pairs (&lt;80 bars):** ZigZag almost never confirms — we **bootstrap** from the
 * deepest lows in-range until history grows, then switch to full swings. If ZigZag yields
 * nothing on longer history, we fall back to the same bootstrap so pumps aren’t empty.
 *
 * Detection candles should match **chart interval** (caller passes `fetchPumpCandlesPaged`
 * with the same interval as the visible chart).
 */

import type { ChartInterval } from "@/lib/pumpCandles";

/** Default when caller doesn’t specify (Setup scripts / tests). */
export const FLOOR_DETECTION_INTERVAL: ChartInterval = "5m";

/** Three pages × 1 000 bars — matches CaChartPanel prefetch. */
export const FLOOR_DETECTION_PAGES = 3;

export const MIN_DETECTION_CANDLES = 80;

/** Minimum bars before we attempt any shelf line (brand‑new pairs may only have a handful). */
export const MIN_BOOTSTRAP_CANDLES = 3;

/** Minimum gap between returned zone prices (fraction). */
const MIN_ZONE_SEPARATION_FRAC = 0.15;

/** Maximum levels to return. */
const MAX_ZONES = 2;

/** Zones must be at least this far BELOW current price (7 %). */
const FLOOR_MARGIN_FRAC = 0.07;

/** Skip levels more than this fraction below current price. */
const MAX_FLOOR_DISTANCE_FRAC = 0.58;

/** Absolute MC floor — skip launch-band noise below $3 k. */
const MIN_FLOOR_MC_USD = 3_000;

/** Merge rows whose prices almost coincide (axis dedupe). */
const CLUSTER_FRAC = 0.004;

/** Wick proximity for touch counting (fraction of pivot price). */
const TOUCH_RADIUS_FRAC = 0.04;

/** Round MC ladder — must sit below spot; aligned shelves get `swing+XX`. */
const PSYCHO_MC_LEVELS = [
  5_000, 7_500, 10_000, 12_500, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000,
  50_000, 60_000, 75_000, 100_000, 125_000, 150_000, 200_000, 250_000, 300_000, 400_000,
  500_000, 750_000, 1_000_000,
] as const;

/** Max distance between pivot and psych level to tag (fraction). */
const PSY_ALIGN_FRAC = 0.08;

function minRetraceFracFromTyp(typ: number): number {
  return clamp(typ * 2.75, 0.045, 0.22);
}

export type BounceZone = {
  price: number;
  confluenceScore: number;
  /** `swing` or `swing+50K` etc. when near a round MC magnet. */
  sources: string;
  strength: number;
  lastTouchAgo: number;
  isSupport: boolean;
  touches: number;
  windowHours?: undefined;
};

type TimedCandle = {
  time: number;
  high: number;
  low: number;
  close: number;
};

type Pivot = { kind: "H" | "L"; idx: number; price: number };

function medianTypicalRangeFrac(candles: TimedCandle[]): number {
  const fracs: number[] = [];
  for (const c of candles) {
    const mid = (c.high + c.low) / 2;
    if (!(mid > 0)) continue;
    fracs.push((c.high - c.low) / mid);
  }
  if (fracs.length === 0) return 0.025;
  fracs.sort((a, b) => a - b);
  return fracs[Math.floor(fracs.length * 0.5)]!;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Median bar spacing in seconds (robust to gaps). */
function inferMedianBucketSec(candles: TimedCandle[]): number {
  if (candles.length < 3) return 300;
  const ds: number[] = [];
  const cap = Math.min(80, candles.length);
  for (let i = 1; i < cap; i++) {
    const d = candles[i]!.time - candles[i - 1]!.time;
    if (d > 0 && d < 86400) ds.push(d);
  }
  if (ds.length === 0) return 300;
  ds.sort((a, b) => a - b);
  return clamp(ds[Math.floor(ds.length / 2)]!, 1, 3600);
}

/** Synthetic peak for first swing: max high in ~12h window before the low (not since genesis). */
function cappedSynthPeakHigh(lowIdx: number, candles: TimedCandle[]): number {
  const bucket = inferMedianBucketSec(candles);
  const bars12h = Math.ceil((12 * 3600) / bucket);
  const lookback = clamp(bars12h, 48, 400);
  const start = Math.max(0, lowIdx - lookback);
  let maxH = 0;
  for (let i = start; i <= lowIdx; i++) maxH = Math.max(maxH, candles[i]!.high);
  return maxH;
}

function formatPsychShort(level: number): string {
  if (level >= 1_000_000) {
    const m = level / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`.replace(/\.0M$/, "M");
  }
  if (level >= 1000) return `${Math.round(level / 1000)}K`;
  return String(level);
}

/** Nearest psych MC rung near `price` and below `spot`, within PSY_ALIGN_FRAC. */
function alignedPsychTag(price: number, spot: number): string | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const L of PSYCHO_MC_LEVELS) {
    if (L >= spot || L < MIN_FLOOR_MC_USD) continue;
    const dist = Math.abs(L - price) / Math.max(price, 1);
    if (dist <= PSY_ALIGN_FRAC && dist < bestDist) {
      best = L;
      bestDist = dist;
    }
  }
  return best != null ? formatPsychShort(best) : null;
}

function countTouchesNearPrice(candles: TimedCandle[], price: number): number {
  let n = 0;
  for (const c of candles) {
    if (price > 0 && Math.abs(c.low - price) / price <= TOUCH_RADIUS_FRAC) n++;
  }
  return n;
}

function zigzagPivots(candles: TimedCandle[], reversalFrac: number): Pivot[] {
  const n = candles.length;
  const pivots: Pivot[] = [];

  let dir: "seek_low" | "seek_high" = "seek_low";
  let extremeIdx = 0;
  let extremePrice = candles[0]!.low;

  for (let i = 1; i < n; i++) {
    const c = candles[i]!;

    if (dir === "seek_low") {
      if (c.low < extremePrice) {
        extremePrice = c.low;
        extremeIdx = i;
      }
      if (extremePrice > 0 && c.high >= extremePrice * (1 + reversalFrac)) {
        pivots.push({ kind: "L", idx: extremeIdx, price: extremePrice });
        dir = "seek_high";
        extremePrice = c.high;
        extremeIdx = i;
      }
    } else {
      if (c.high > extremePrice) {
        extremePrice = c.high;
        extremeIdx = i;
      }
      if (extremePrice > 0 && c.low <= extremePrice * (1 - reversalFrac)) {
        pivots.push({ kind: "H", idx: extremeIdx, price: extremePrice });
        dir = "seek_low";
        extremePrice = c.low;
        extremeIdx = i;
      }
    }
  }

  return pivots;
}

/** Peak before swing low: preceding ZigZag high, else capped synthetic peak. */
function priorPeakBeforeSwingLow(
  pivots: Pivot[],
  k: number,
  candles: TimedCandle[],
): number | null {
  const low = pivots[k]!;
  if (low.kind !== "L") return null;
  if (k >= 1 && pivots[k - 1]!.kind === "H") return pivots[k - 1]!.price;
  const h = cappedSynthPeakHigh(low.idx, candles);
  return h > 0 ? h : null;
}

function swingLowsWithMinPullback(
  pivots: Pivot[],
  candles: TimedCandle[],
  minRetraceFrac: number,
): Pivot[] {
  const out: Pivot[] = [];
  for (let k = 0; k < pivots.length; k++) {
    const p = pivots[k]!;
    if (p.kind !== "L") continue;
    const peak = priorPeakBeforeSwingLow(pivots, k, candles);
    if (peak == null || peak <= p.price) continue;
    const retrace = (peak - p.price) / peak;
    if (retrace >= minRetraceFrac) out.push(p);
  }
  return out;
}

function mergeSourceTokens(a: string | undefined, b: string | undefined): string {
  const parts = [...new Set([...(a?.split("+") ?? []), ...(b?.split("+") ?? [])].filter(Boolean))];
  parts.sort((x, y) => {
    if (x === "swing") return -1;
    if (y === "swing") return 1;
    return x.localeCompare(y);
  });
  return parts.join("+");
}

/** Last adjustment: max allowed dip below detector price (reject absurd outliers). */
const LAST_ADJUST_MAX_EXTRA_DEPTH_FRAC = 0.28;

/**
 * **Last adjustment** — after ZigZag + filters, snap each shelf to the **true minimum wick**
 * in a ±time window around the swing pivot. Detector price can sit above the deepest printed low;
 * this aligns the line with the chart.
 */
function lastAdjustmentSnapToWickLows(
  candles: TimedCandle[],
  spot: number,
  picked: ReadonlyArray<{ pivotIdx: number; zone: BounceZone }>,
): BounceZone[] {
  const n = candles.length;
  const bucket = inferMedianBucketSec(candles);
  const halfWindow = clamp(Math.ceil((24 * 3600) / bucket), 48, 720);
  const EPS_CEIL = 1.004;

  return picked.map(({ pivotIdx, zone }) => {
    const lo = Math.max(0, pivotIdx - halfWindow);
    const hi = Math.min(n - 1, pivotIdx + halfWindow);
    const detector = zone.price;

    let deepest = Number.POSITIVE_INFINITY;
    for (let i = lo; i <= hi; i++) {
      const low = candles[i]!.low;
      if (low > 0 && low <= detector * EPS_CEIL) deepest = Math.min(deepest, low);
    }
    if (!Number.isFinite(deepest)) deepest = detector;

    const minAllowed = detector * (1 - LAST_ADJUST_MAX_EXTRA_DEPTH_FRAC);
    /** Deepest wick at or under the shelf, but never chase more than ~28% below detector (bad ticks). */
    const price = clamp(deepest, minAllowed, detector);

    const touches = countTouchesNearPrice(candles, price);
    const psych = alignedPsychTag(price, spot);
    const sources = psych ? `swing+${psych}` : "swing";
    const touchBoost = Math.min(touches, 12) / 12;

    return {
      ...zone,
      price,
      sources,
      touches,
      strength: clamp(zone.strength * 0.92 + 0.08 * touchBoost, 0.35, 1),
      confluenceScore: zone.confluenceScore * 0.85 + touchBoost * 0.15,
    };
  });
}

export function dedupeDetectedZones(zones: BounceZone[]): BounceZone[] {
  const sorted = [...zones].sort((a, b) => b.price - a.price);
  const out: BounceZone[] = [];
  for (const z of sorted) {
    const dup = out.find(
      (o) => o.price > 0 && Math.abs(z.price - o.price) / Math.min(z.price, o.price) <= CLUSTER_FRAC,
    );
    if (!dup) {
      out.push({ ...z });
      continue;
    }
    dup.price = (dup.price + z.price) / 2;
    dup.confluenceScore += z.confluenceScore;
    dup.touches += z.touches;
    dup.strength = Math.max(dup.strength, z.strength);
    dup.sources = mergeSourceTokens(dup.sources, z.sources);
  }
  return out.slice(0, MAX_ZONES);
}

function bootstrapSparseHistoryZones(candles: TimedCandle[], lastClose: number): BounceZone[] {
  const lowerBound = lastClose * (1 - MAX_FLOOR_DISTANCE_FRAC);
  const upperBound = lastClose / (1 + FLOOR_MARGIN_FRAC);
  const n = candles.length;

  type Pt = { idx: number; low: number };
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const low = candles[i]!.low;
    if (low >= MIN_FLOOR_MC_USD && low >= lowerBound && low < upperBound) pts.push({ idx: i, low });
  }
  if (pts.length === 0) return [];

  pts.sort((a, b) => a.low - b.low);

  const picked: Array<{ pivotIdx: number; zone: BounceZone }> = [];
  for (const { idx, low } of pts) {
    const far = picked.every(({ zone: z }) => {
      const denom = Math.min(z.price, low);
      return denom <= 0 || Math.abs(z.price - low) / denom >= MIN_ZONE_SEPARATION_FRAC;
    });
    if (!far) continue;

    const ago = n - 1 - idx;
    const recency = 1 - ago / Math.max(n, 1);
    const touches = countTouchesNearPrice(candles, low);
    const psych = alignedPsychTag(low, lastClose);
    const sources = psych ? `swing+${psych}` : "swing";
    const touchBoost = Math.min(touches, 12) / 12;
    const strength = clamp(0.32 + 0.48 * recency + 0.2 * touchBoost, 0.35, 1);

    picked.push({
      pivotIdx: idx,
      zone: {
        price: low,
        confluenceScore: recency * 0.65 + touchBoost * 0.35,
        sources,
        strength,
        lastTouchAgo: ago,
        isSupport: true,
        touches,
      },
    });

    if (picked.length >= MAX_ZONES) break;
  }

  const snapped = lastAdjustmentSnapToWickLows(candles, lastClose, picked);
  return dedupeDetectedZones(snapped);
}

export function detectBounceZones(
  candles: TimedCandle[],
  currentPrice?: number,
): BounceZone[] {
  if (candles.length < MIN_BOOTSTRAP_CANDLES) return [];

  const lastClose = currentPrice ?? candles[candles.length - 1]!.close;
  if (!lastClose || lastClose <= 0) return [];

  if (candles.length < MIN_DETECTION_CANDLES) {
    return bootstrapSparseHistoryZones(candles, lastClose);
  }

  const lowerBound = lastClose * (1 - MAX_FLOOR_DISTANCE_FRAC);
  const upperBound = lastClose / (1 + FLOOR_MARGIN_FRAC);

  const bucketSec = inferMedianBucketSec(candles);
  const typ = medianTypicalRangeFrac(candles);
  // Sub‑minute bars: demand slightly larger reversal vs noise
  let reversalFrac = clamp(typ * 3.2, 0.028, 0.14);
  if (bucketSec <= 10) reversalFrac = Math.max(reversalFrac, 0.038);
  const minRetrace = minRetraceFracFromTyp(typ);

  const pivots = zigzagPivots(candles, reversalFrac);
  const swingLows = swingLowsWithMinPullback(pivots, candles, minRetrace);

  const total = candles.length;
  type Cand = { pivot: Pivot; ago: number; recency: number; touches: number };
  const candidates: Cand[] = [];

  for (const p of swingLows) {
    if (p.price < MIN_FLOOR_MC_USD || p.price < lowerBound || p.price >= upperBound) continue;
    const ago = total - 1 - p.idx;
    const recency = 1 - ago / Math.max(total, 1);
    const touches = countTouchesNearPrice(candles, p.price);
    candidates.push({ pivot: p, ago, recency, touches });
  }

  candidates.sort(
    (a, b) =>
      b.recency - a.recency ||
      b.touches - a.touches ||
      b.pivot.price - a.pivot.price,
  );

  const picked: Array<{ pivotIdx: number; zone: BounceZone }> = [];
  for (const { pivot: p, ago, recency, touches } of candidates) {
    const far = picked.every(({ zone: z }) => {
      const denom = Math.min(z.price, p.price);
      return denom <= 0 || Math.abs(z.price - p.price) / denom >= MIN_ZONE_SEPARATION_FRAC;
    });
    if (!far) continue;

    const psych = alignedPsychTag(p.price, lastClose);
    const sources = psych ? `swing+${psych}` : "swing";
    const touchBoost = Math.min(touches, 12) / 12;
    const strength = clamp(0.28 + 0.52 * recency + 0.2 * touchBoost, 0.35, 1);

    picked.push({
      pivotIdx: p.idx,
      zone: {
        price: p.price,
        confluenceScore: recency * 0.7 + touchBoost * 0.3,
        sources,
        strength,
        lastTouchAgo: ago,
        isSupport: true,
        touches,
      },
    });

    if (picked.length >= MAX_ZONES) break;
  }

  const snapped = lastAdjustmentSnapToWickLows(candles, lastClose, picked);
  const out = dedupeDetectedZones(snapped);
  if (out.length > 0) return out;
  return bootstrapSparseHistoryZones(candles, lastClose);
}

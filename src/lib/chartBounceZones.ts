/**
 * Bounce-zone (support level) detection from OHLC candle data.
 *
 * Every candidate floor must pass the FloorTool — a sequential checklist that
 * gates on bounce quality, temporal spread, and crucially whether price has
 * since broken through the level.  Only floors that pass all checks reach the
 * user. Marginal / broken levels are silently dropped; the trader should place
 * those manually.
 *
 * Algorithm overview:
 *  1. Pivot lows (wide neighbourhood) with confirmed forward recovery.
 *  2. Cluster pivots whose price agrees tightly.
 *  3. FloorTool validates each cluster (temporal spread, touch gap, broken-floor).
 *  4. Score and deduplicate by minimum zone separation.
 */

// ─── Pivot detection ────────────────────────────────────────────────────────

/** Bars either side — wider window produces fewer, cleaner swing lows. */
const PIVOT_WING = 5;

/** Max forward candles used to confirm a bounce after each pivot low. */
const RECOVERY_LOOKAHEAD = 12;

/** Minimum rally (high / pivot low - 1) within RECOVERY_LOOKAHEAD to accept the pivot. */
const MIN_RECOVERY_FRAC = 0.04;

// ─── Clustering ─────────────────────────────────────────────────────────────

/** Pivots within this fraction of the running mean merge into one cluster. */
const CLUSTER_PCT = 0.03;

/** Max fraction spread of pivot prices around the median inside a cluster. */
const MAX_CLUSTER_SPREAD_FRAC = 0.02;

// ─── FloorTool check thresholds ─────────────────────────────────────────────

/** Minimum number of individual touches to qualify. */
const MIN_TOUCHES = 3;

/**
 * Adjacent touches in a cluster must be at least this many candles apart.
 * Prevents a 10-bar sideways squeeze counting as 5 "touches".
 */
const MIN_TOUCH_GAP_CANDLES = 10;

/**
 * First and last touch must span at least this many candles.
 * A level tested once at t=50 and once at t=55 is a consolidation, not a floor.
 */
const MIN_TOUCH_SPAN_CANDLES = 30;

/**
 * Broken-floor threshold: if price closes this far below the candidate level
 * for BROKEN_FLOOR_STREAK consecutive candles after the first touch, the floor
 * is considered violated and is dropped.
 */
const BROKEN_FLOOR_CLOSE_FRAC = 0.025;
const BROKEN_FLOOR_STREAK = 3;

// ─── Scoring & output ────────────────────────────────────────────────────────

/** Half-life for recency decay (candles from right edge). */
const RECENCY_HALF_LIFE = 50;

/** Minimum price gap between any two returned zones (fraction of price). */
const MIN_ZONE_SEPARATION_FRAC = 0.055;

/** Maximum zones to surface. Conservative — better fewer high-confidence lines. */
const MAX_ZONES = 3;

/**
 * Candle interval always used for floor detection — independent of display interval.
 * 1000 × 5m ≈ 3.5 days of structural price context.
 * Exported so the chart component knows which candles to fetch for detection.
 */
export const FLOOR_DETECTION_INTERVAL = "5m" as const;

/** Minimum candle history required before running detection. */
const MIN_DETECTION_CANDLES = 60;

// ─── Types ──────────────────────────────────────────────────────────────────

export type BounceZone = {
  /** Mean price of the clustered pivot lows. */
  price: number;
  /** Number of distinct pivot touches at this level. */
  touches: number;
  /** 0–1 composite score (touches × recency). */
  strength: number;
  /** Candles since most recent touch (0 = latest candle). */
  lastTouchAgo: number;
  /** True if level is below the last close (acting as support). */
  isSupport: boolean;
};

type Candle = {
  high: number;
  low: number;
  close: number;
};

type Cluster = { prices: number[]; indices: number[] };

// ─── Internal helpers ───────────────────────────────────────────────────────

function recencyWeight(agoCandles: number): number {
  return Math.pow(0.5, agoCandles / RECENCY_HALF_LIFE);
}

/**
 * Confirms the pivot low was followed by a real rally, not micro-chop.
 * Requires the highest high in the next RECOVERY_LOOKAHEAD candles to be
 * at least MIN_RECOVERY_FRAC above the pivot low.
 */
function pivotHasRecovery(candles: Candle[], idx: number): boolean {
  const low = candles[idx]!.low;
  if (!Number.isFinite(low) || low <= 0) return false;
  const end = Math.min(idx + RECOVERY_LOOKAHEAD, candles.length - 1);
  if (end <= idx) return false;
  let maxHigh = -Infinity;
  for (let j = idx + 1; j <= end; j++) {
    const h = candles[j]!.high;
    if (h > maxHigh) maxHigh = h;
  }
  return maxHigh >= low * (1 + MIN_RECOVERY_FRAC);
}

// ─── FloorTool ──────────────────────────────────────────────────────────────

type FloorCheckResult =
  | { pass: true }
  | { pass: false; reason: string };

/**
 * FloorTool — sequential validation checkpoint.
 *
 * Checks (in order):
 *  1. Price agreement inside the cluster is tight.
 *  2. Individual touches are spaced apart (not one long consolidation event).
 *  3. The touch history spans enough time (genuinely repeated tests).
 *  4. The floor has not been broken — price hasn't closed decisively below
 *     the level for several consecutive bars after the first touch.
 */
function runFloorTool(candles: Candle[], cl: Cluster, levelPrice: number): FloorCheckResult {
  // 1. Cluster price tightness
  const sortedPrices = [...cl.prices].sort((a, b) => a - b);
  const mid = sortedPrices.length >> 1;
  const median = sortedPrices.length % 2
    ? sortedPrices[mid]!
    : (sortedPrices[mid - 1]! + sortedPrices[mid]!) / 2;
  if (!Number.isFinite(median) || median <= 0) return { pass: false, reason: "degenerate median" };
  const spread = (Math.max(...cl.prices) - Math.min(...cl.prices)) / median;
  if (spread > MAX_CLUSTER_SPREAD_FRAC) {
    return { pass: false, reason: `cluster spread too wide (${(spread * 100).toFixed(1)}%)` };
  }

  // 2. Adjacent touch spacing
  const sortedIdx = [...cl.indices].sort((a, b) => a - b);
  for (let i = 1; i < sortedIdx.length; i++) {
    if (sortedIdx[i]! - sortedIdx[i - 1]! < MIN_TOUCH_GAP_CANDLES) {
      return { pass: false, reason: "touches too close together in time" };
    }
  }

  // 3. Temporal span
  const span = sortedIdx[sortedIdx.length - 1]! - sortedIdx[0]!;
  if (span < MIN_TOUCH_SPAN_CANDLES) {
    return { pass: false, reason: `touch span too short (${span} candles, need ${MIN_TOUCH_SPAN_CANDLES})` };
  }

  // 4. Broken-floor check
  // Scan every candle AFTER the first known touch. If BROKEN_FLOOR_STREAK
  // consecutive closes land more than BROKEN_FLOOR_CLOSE_FRAC below the level
  // price, the floor has been violated.
  const firstTouchIdx = sortedIdx[0]!;
  const breakLine = levelPrice * (1 - BROKEN_FLOOR_CLOSE_FRAC);
  let belowStreak = 0;
  for (let i = firstTouchIdx + 1; i < candles.length; i++) {
    if (candles[i]!.close < breakLine) {
      belowStreak++;
      if (belowStreak >= BROKEN_FLOOR_STREAK) {
        return { pass: false, reason: "floor broken — price closed decisively below level" };
      }
    } else {
      belowStreak = 0;
    }
  }

  return { pass: true };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * @param candles      Full OHLC history (should be FLOOR_DETECTION_INTERVAL candles).
 * @param currentPrice Live current price — used as a last-mile broken-floor guard.
 *                     Pass `undefined` if unavailable; FloorTool historical check still runs.
 */
export function detectBounceZones(candles: Candle[], currentPrice?: number): BounceZone[] {
  if (candles.length < MIN_DETECTION_CANDLES) return [];

  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const total = candles.length;

  // ── Pass 1: pivot lows ──────────────────────────────────────────────────
  type PivotLow = { price: number; idx: number };
  const pivots: PivotLow[] = [];

  for (let i = PIVOT_WING; i < total - PIVOT_WING; i++) {
    const low = candles[i]!.low;
    let isPivot = true;
    for (let j = i - PIVOT_WING; j <= i + PIVOT_WING; j++) {
      if (j !== i && candles[j]!.low <= low) { isPivot = false; break; }
    }
    if (!isPivot) continue;
    if (!pivotHasRecovery(candles, i)) continue;
    pivots.push({ price: low, idx: i });
  }

  if (pivots.length === 0) return [];

  // ── Pass 2: cluster into price levels ───────────────────────────────────
  const clusters: Cluster[] = [];

  for (const piv of pivots) {
    let matched = false;
    for (const cl of clusters) {
      const rep = cl.prices.reduce((a, b) => a + b, 0) / cl.prices.length;
      if (Math.abs(piv.price - rep) / rep < CLUSTER_PCT) {
        cl.prices.push(piv.price);
        cl.indices.push(piv.idx);
        matched = true;
        break;
      }
    }
    if (!matched) clusters.push({ prices: [piv.price], indices: [piv.idx] });
  }

  // ── Pass 3: FloorTool validation + scoring ───────────────────────────────
  const zones: BounceZone[] = [];

  for (const cl of clusters) {
    const touches = cl.prices.length;
    if (touches < MIN_TOUCHES) continue;

    const price = cl.prices.reduce((a, b) => a + b, 0) / cl.prices.length;

    const check = runFloorTool(candles, cl, price);
    if (!check.pass) continue;

    const lastIdx = Math.max(...cl.indices);
    const lastTouchAgo = total - 1 - lastIdx;
    const minAgo = Math.min(...cl.indices.map((idx) => total - 1 - idx));
    const strength = Math.min(1, (touches / 5) * recencyWeight(minAgo));

    zones.push({ price, touches, strength, lastTouchAgo, isSupport: price < lastClose });
  }

  // ── Pass 4: deduplicate by minimum separation ───────────────────────────
  const sorted = zones.sort((a, b) => b.strength - a.strength);
  const picked: BounceZone[] = [];

  for (const z of sorted) {
    const farEnough = picked.every((p) => {
      const denom = Math.min(z.price, p.price);
      return denom <= 0 || Math.abs(z.price - p.price) / denom >= MIN_ZONE_SEPARATION_FRAC;
    });
    if (!farEnough) continue;
    picked.push(z);
    if (picked.length >= MAX_ZONES) break;
  }

  // ── Final live-price guard ───────────────────────────────────────────────
  // If a real-time price is available, drop any floor that current price has
  // already broken through — the FloorTool only sees closed REST candles which
  // can lag by up to 30s.
  if (currentPrice != null && currentPrice > 0) {
    const breakLine = 1 - BROKEN_FLOOR_CLOSE_FRAC;
    return picked.filter((z) => currentPrice >= z.price * breakLine);
  }

  return picked;
}

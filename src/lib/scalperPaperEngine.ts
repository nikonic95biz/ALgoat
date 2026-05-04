import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import type { BondingSnapshot } from "@/lib/pumpPaperBondingSim";
import { simulatePumpPaperRoundTripSol } from "@/lib/pumpPaperBondingSim";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import type { ScalperUserConfig } from "@/context/AppContext";

/**
 * Lifecycle the sidebar mirrors.
 *
 *  watching  → price not dipped, not near any zone
 *  nearing   → price dipped AND is within NEARING_ZONE_PCT of a bounce zone (pre-arm signal)
 *  dip       → price dipped but zone not yet aligned (or no zones configured)
 *  arming    → dip + zone aligned, latch open — next qualifying catalyst buy fires entry
 *  in_trade  → position open
 */
export type ScalperPaperStatus = "watching" | "nearing" | "dip" | "arming" | "in_trade";

export type ScalperPaperCurrent = {
  entryMcUsd: number;
  catalystSol: number;
  lastMcUsd: number | null;
  unrealizedPct: number | null;
};

/** One closed round-trip — paper uses tape MC; live uses parsed on-chain SOL deltas. */
export type BotTradeRowTape = {
  kind: "tape";
  id: string;
  closedAtTs: number;
  entryMcUsd: number;
  exitMcUsd: number;
  pnlPct: number;
  exitReason: "take_profit" | "order_book_sell";
  paperSolEstimate?: {
    solSpent: number;
    solReceived: number;
    netSol: number;
    roiPct: number;
  };
};

export type BotTradeRowChain = {
  kind: "chain";
  id: string;
  closedAtTs: number;
  exitReason: "take_profit" | "order_book_sell";
  buySignature: string;
  sellSignature: string;
  solSpent: number;
  solReceived: number;
  netSol: number;
  roiPct: number;
};

export type BotTradeRow = BotTradeRowTape | BotTradeRowChain;

export function isBotTradeChain(r: BotTradeRow): r is BotTradeRowChain {
  return r.kind === "chain";
}

export type PaperChartMarker = {
  timeSec: number;
  side: "buy" | "sell";
};

export type ScalperPaperSnapshot = {
  status: ScalperPaperStatus;
  winRate: number | null;
  totalPnlPct: number;
  closedTrades: number;
  wins: number;
  currentTrade: ScalperPaperCurrent | null;
  lastClosedPnlPct: number | null;
  botTrades: BotTradeRow[];
  paperMarkers: PaperChartMarker[];
};

type Position = {
  entryMcUsd: number;
  catalystSol: number;
  bondingAtEntry: BondingSnapshot | null;
};

function dipFromPeak(peak: number, mc: number): number {
  if (peak <= 0 || mc <= 0) return 0;
  return ((peak - mc) / peak) * 100;
}

/** MC must be within this fraction of a zone price for zone-alignment to fire. */
const BOUNCE_ZONE_PCT = 0.1;
/**
 * "Nearing" window: price is within this fraction BELOW a zone (slightly past it)
 * OR within NEARING_ABOVE_PCT ABOVE it (approaching from above). No dip required.
 */
const NEARING_ZONE_PCT = 0.15;
/** How far above a zone price can be and still count as "approaching" / nearing. */
const NEARING_ABOVE_PCT = 0.25;
/** Drop “armed for catalyst” if tape goes quiet this long after latch opened (ms). */
const MAX_LATCH_MS = 120_000;

/**
 * Paper Scalper — behavior is defined by {@link SCALPER_PAPER_CONFIG}.
 *
 * Entries use a **catalyst latch**: once tape shows dip + zone alignment, we arm;
 * the very next qualifying buy prints entry even if that buy spikes MC out of the dip
 * on the same row (classic missed-fill bug when dip and catalyst were required together).
 */
export type ReduceScalperPaperOpts = {
  minTradeTsMs?: number;
  paperBuySol?: number;
  scalperConfig?: ScalperUserConfig;
  /**
   * Bounce-zone proximity for **opening** the latch only.
   * Entry after latch does not re-check zones (catalyst row often spikes MC).
   */
  activeBounceZonePrices?: number[];
};

export function reduceScalperPaper(
  rows: PumpPortalLiveRow[],
  opts?: ReduceScalperPaperOpts,
): ScalperPaperSnapshot {
  const C = opts?.scalperConfig
    ? { ...SCALPER_PAPER_CONFIG, ...opts.scalperConfig }
    : SCALPER_PAPER_CONFIG;

  let chronological = [...rows].sort((a, b) => a.ts - b.ts);
  if (opts?.minTradeTsMs != null) {
    const minTs = opts.minTradeTsMs;
    chronological = chronological.filter((r) => r.ts >= minTs);
  }

  const zones = opts?.activeBounceZonePrices;

  let peakMc = 0;
  let pos: Position | null = null;
  let lastMc: number | null = null;
  let lastExitAtMs = 0;
  let latchActive = false;
  let latchSinceTs = 0;

  const closedPnl: number[] = [];
  const botTrades: BotTradeRow[] = [];
  const paperMarkers: PaperChartMarker[] = [];
  let tradeSeq = 0;

  function zoneOkForMc(mc: number): boolean {
    if (zones === undefined) return true;
    if (zones.length === 0) return false;
    return zones.some((zp) => zp > 0 && Math.abs(mc - zp) / zp <= BOUNCE_ZONE_PCT);
  }

  /**
   * True when price is in the "approach corridor" of any zone:
   *   - within NEARING_ABOVE_PCT (25 %) above the zone price (descending toward it), OR
   *   - within NEARING_ZONE_PCT (15 %) below it (just overshot, still relevant).
   * No dip-from-peak requirement — fires even when price is near ATH if a zone is close.
   */
  function zoneNearingForMc(mc: number): boolean {
    if (!zones || zones.length === 0) return false;
    return zones.some(
      (zp) => zp > 0 && mc > zp * (1 - NEARING_ZONE_PCT) && mc < zp * (1 + NEARING_ABOVE_PCT),
    );
  }

  for (const r of chronological) {
    const mc = r.mcUsd;
    const mcValid = mc != null && Number.isFinite(mc) && mc > 0;

    /** Peak from all strictly prior prints — compare dip before we fold this bar into peak. */
    const priorPeakMc = peakMc;

    if (mcValid) {
      peakMc = Math.max(peakMc, mc);
      lastMc = mc;
    }

    if (pos) {
      const px = mc ?? lastMc;
      if (px != null && px > 0) {
        const sellCountsAsStop =
          r.buy === false && (r.sol <= 0 || r.sol >= C.minOrderBookSellSolForStop);
        if (sellCountsAsStop) {
          const pnl = ((px - pos.entryMcUsd) / pos.entryMcUsd) * 100;
          closedPnl.push(pnl);
          tradeSeq += 1;
          const paperSolEstimate =
            opts?.paperBuySol != null && pos.bondingAtEntry != null && r.bonding != null
              ? simulatePumpPaperRoundTripSol(pos.bondingAtEntry, r.bonding, opts.paperBuySol) ?? undefined
              : undefined;
          botTrades.push({
            kind: "tape",
            id: `paper-${r.ts}-${tradeSeq}`,
            closedAtTs: r.ts,
            entryMcUsd: pos.entryMcUsd,
            exitMcUsd: px,
            pnlPct: pnl,
            exitReason: "order_book_sell",
            ...(paperSolEstimate ? { paperSolEstimate } : {}),
          });
          paperMarkers.push({ timeSec: Math.floor(r.ts / 1000), side: "sell" });
          peakMc = px;
          lastExitAtMs = r.ts;
          pos = null;
          latchActive = false;
          latchSinceTs = 0;
          continue;
        }
        if (px >= pos.entryMcUsd * (1 + C.takeProfitPct / 100)) {
          const pnl = ((px - pos.entryMcUsd) / pos.entryMcUsd) * 100;
          closedPnl.push(pnl);
          tradeSeq += 1;
          const paperSolEstimate =
            opts?.paperBuySol != null && pos.bondingAtEntry != null && r.bonding != null
              ? simulatePumpPaperRoundTripSol(pos.bondingAtEntry, r.bonding, opts.paperBuySol) ?? undefined
              : undefined;
          botTrades.push({
            kind: "tape",
            id: `paper-${r.ts}-${tradeSeq}`,
            closedAtTs: r.ts,
            entryMcUsd: pos.entryMcUsd,
            exitMcUsd: px,
            pnlPct: pnl,
            exitReason: "take_profit",
            ...(paperSolEstimate ? { paperSolEstimate } : {}),
          });
          paperMarkers.push({ timeSec: Math.floor(r.ts / 1000), side: "sell" });
          peakMc = px;
          lastExitAtMs = r.ts;
          pos = null;
          latchActive = false;
          latchSinceTs = 0;
        }
      }
      continue;
    }

    if (lastExitAtMs > 0 && r.ts - lastExitAtMs < C.reentryCooldownMs) {
      continue;
    }

    if (latchActive && latchSinceTs > 0 && r.ts - latchSinceTs > MAX_LATCH_MS) {
      latchActive = false;
      latchSinceTs = 0;
    }

    const catalystBuy =
      r.buy && r.sol >= C.catalystMinSol && (mcValid || (lastMc != null && lastMc > 0));

    const dipNow =
      mcValid &&
      priorPeakMc > 0 &&
      dipFromPeak(priorPeakMc, mc) > C.dipMinPct;

    const zoneNow = mcValid && zoneOkForMc(mc);

    if (dipNow && zoneNow) {
      latchActive = true;
      if (latchSinceTs === 0) latchSinceTs = r.ts;
    }

    const entryMc = mcValid ? mc! : lastMc;
    const entryOk = entryMc != null && entryMc > 0 && Number.isFinite(entryMc);

    if (latchActive && catalystBuy && entryOk) {
      pos = { entryMcUsd: entryMc!, catalystSol: r.sol, bondingAtEntry: r.bonding };
      paperMarkers.push({ timeSec: Math.floor(r.ts / 1000), side: "buy" });
      latchActive = false;
      latchSinceTs = 0;
    }

    if (!pos && latchActive && lastMc != null && peakMc > 0) {
      if (dipFromPeak(peakMc, lastMc) <= C.dipMinPct) {
        latchActive = false;
        latchSinceTs = 0;
      }
    }
  }

  const wins = closedPnl.filter((p) => p > 0).length;
  const n = closedPnl.length;
  const winRate = n > 0 ? (wins / n) * 100 : null;
  const totalPnlPct = closedPnl.reduce((s, p) => s + p, 0);

  const fullDip =
    lastMc != null && peakMc > 0 && dipFromPeak(peakMc, lastMc) > C.dipMinPct;

  let status: ScalperPaperStatus = "watching";
  if (pos) {
    status = "in_trade";
  } else if (latchActive) {
    status = "arming";
  } else if (fullDip) {
    // Dipped past threshold but zone not yet aligned (or no zones) — latch would be open if aligned
    status = "dip";
  } else if (lastMc != null && zoneNearingForMc(lastMc)) {
    // Price is in the approach corridor of a zone (up to 25 % above or 15 % below)
    // No dip requirement — fires immediately when user moves a zone near current price
    status = "nearing";
  }

  let currentTrade: ScalperPaperCurrent | null = null;
  if (pos && lastMc != null) {
    currentTrade = {
      entryMcUsd: pos.entryMcUsd,
      catalystSol: pos.catalystSol,
      lastMcUsd: lastMc,
      unrealizedPct: ((lastMc - pos.entryMcUsd) / pos.entryMcUsd) * 100,
    };
  }

  return {
    status,
    winRate,
    totalPnlPct,
    closedTrades: n,
    wins,
    currentTrade,
    lastClosedPnlPct: n > 0 ? closedPnl[closedPnl.length - 1]! : null,
    botTrades,
    paperMarkers,
  };
}

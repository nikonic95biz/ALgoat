import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";

const C = SCALPER_PAPER_CONFIG;

export type ScalperPaperStatus = "watching" | "dip" | "armed";

export type ScalperPaperCurrent = {
  entryMcUsd: number;
  catalystSol: number;
  lastMcUsd: number | null;
  unrealizedPct: number | null;
};

/** One closed round-trip the bot recorded (paper or real). */
export type BotTradeRow = {
  id: string;
  closedAtTs: number;
  entryMcUsd: number;
  exitMcUsd: number;
  pnlPct: number;
  exitReason: "take_profit" | "order_book_sell";
};

/** Bubble markers for chart overlay: paper entry (buy) and exit (sell). */
export type PaperChartMarker = {
  timeSec: number;
  side: "buy" | "sell";
};

export type ScalperPaperSnapshot = {
  status: ScalperPaperStatus;
  winRate: number | null;
  /** Sum of closed-trade PnL % (simple aggregate, not compounded). */
  totalPnlPct: number;
  closedTrades: number;
  wins: number;
  currentTrade: ScalperPaperCurrent | null;
  lastClosedPnlPct: number | null;
  /** Closed bot round-trips, oldest → newest (newest at end). */
  botTrades: BotTradeRow[];
  /** Chart bubbles: chronological paper entry/exit times (Unix seconds). */
  paperMarkers: PaperChartMarker[];
};

type Position = {
  entryMcUsd: number;
  catalystSol: number;
};

function dipFromPeak(peak: number, mc: number): number {
  if (peak <= 0 || mc <= 0) return 0;
  return ((peak - mc) / peak) * 100;
}

/**
 * Paper Scalper — behavior is defined by {@link SCALPER_PAPER_CONFIG} (keep preset copy in sync).
 *
 * Peak resets to exit MC after each close so the next leg does not arm off a stale ATH in the buffer.
 * Order-book stops ignore sells below `minOrderBookSellSolForStop` when SOL is known; unknown SOL still stops out.
 */
export type ReduceScalperPaperOpts = {
  /** Only tape rows at or after this timestamp (ms) participate — avoids replaying history when a session arms. */
  minTradeTsMs?: number;
};

export function reduceScalperPaper(
  rows: PumpPortalLiveRow[],
  opts?: ReduceScalperPaperOpts,
): ScalperPaperSnapshot {
  let chronological = [...rows].sort((a, b) => a.ts - b.ts);
  if (opts?.minTradeTsMs != null) {
    const minTs = opts.minTradeTsMs;
    chronological = chronological.filter((r) => r.ts >= minTs);
  }

  let peakMc = 0;
  let pos: Position | null = null;
  let lastMc: number | null = null;
  let lastExitAtMs = 0;
  const closedPnl: number[] = [];
  const botTrades: BotTradeRow[] = [];
  const paperMarkers: PaperChartMarker[] = [];
  let tradeSeq = 0;

  for (const r of chronological) {
    const mc = r.mcUsd;
    if (mc != null && Number.isFinite(mc) && mc > 0) {
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
          botTrades.push({
            id: `paper-${r.ts}-${tradeSeq}`,
            closedAtTs: r.ts,
            entryMcUsd: pos.entryMcUsd,
            exitMcUsd: px,
            pnlPct: pnl,
            exitReason: "order_book_sell",
          });
          paperMarkers.push({ timeSec: Math.floor(r.ts / 1000), side: "sell" });
          peakMc = px;
          lastExitAtMs = r.ts;
          pos = null;
          continue;
        }
        if (px >= pos.entryMcUsd * (1 + C.takeProfitPct / 100)) {
          const pnl = ((px - pos.entryMcUsd) / pos.entryMcUsd) * 100;
          closedPnl.push(pnl);
          tradeSeq += 1;
          botTrades.push({
            id: `paper-${r.ts}-${tradeSeq}`,
            closedAtTs: r.ts,
            entryMcUsd: pos.entryMcUsd,
            exitMcUsd: px,
            pnlPct: pnl,
            exitReason: "take_profit",
          });
          paperMarkers.push({ timeSec: Math.floor(r.ts / 1000), side: "sell" });
          peakMc = px;
          lastExitAtMs = r.ts;
          pos = null;
        }
      }
      continue;
    }

    if (lastExitAtMs > 0 && r.ts - lastExitAtMs < C.reentryCooldownMs) continue;

    if (mc == null || !Number.isFinite(mc) || mc <= 0 || peakMc <= 0) continue;

    const dip = dipFromPeak(peakMc, mc);
    const dipOk = dip > C.dipMinPct;
    const catalystOk = r.buy && r.sol > C.catalystMinSol;
    if (dipOk && catalystOk) {
      pos = { entryMcUsd: mc, catalystSol: r.sol };
      paperMarkers.push({ timeSec: Math.floor(r.ts / 1000), side: "buy" });
    }
  }

  const wins = closedPnl.filter((p) => p > 0).length;
  const n = closedPnl.length;
  const winRate = n > 0 ? (wins / n) * 100 : null;
  const totalPnlPct = closedPnl.reduce((s, p) => s + p, 0);

  let status: ScalperPaperStatus = "watching";
  if (pos) {
    status = "armed";
  } else if (lastMc != null && peakMc > 0 && dipFromPeak(peakMc, lastMc) > C.dipMinPct) {
    status = "dip";
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

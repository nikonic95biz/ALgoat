import type { BotTradeRowTape } from "@/lib/scalperPaperEngine";
import { reduceScalperPaper } from "@/lib/scalperPaperEngine";
import { BUILTIN_SCALPER_STRATEGY } from "@/lib/strategyRegistry";
import type { StrategyReplayInput, StrategyReplayResult } from "@/lib/strategyTypes";

function isTapeTradeWithEstimate(t: unknown): t is BotTradeRowTape & {
  paperSolEstimate: NonNullable<BotTradeRowTape["paperSolEstimate"]>;
} {
  return Boolean(
    t &&
    typeof t === "object" &&
    (t as BotTradeRowTape).kind === "tape" &&
    (t as BotTradeRowTape).paperSolEstimate,
  );
}

export function replayBuiltInScalper(input: StrategyReplayInput): StrategyReplayResult {
  const rows = [...input.rows].sort((a, b) => a.ts - b.ts);
  const snapshot = reduceScalperPaper(rows, {
    scalperConfig: input.config,
    activeBounceZonePrices: input.activeBounceZonePrices,
    paperBuySol: input.paperBuySol,
    minTradeTsMs: input.minTradeTsMs,
  });

  const pnl = snapshot.botTrades
    .filter((t): t is BotTradeRowTape => t.kind === "tape")
    .map((t) => t.pnlPct);

  const solEstimates = snapshot.botTrades.filter(isTapeTradeWithEstimate);
  const grossPaperSolNet =
    solEstimates.length > 0
      ? solEstimates.reduce((sum, t) => sum + t.paperSolEstimate.netSol, 0)
      : null;

  const buyCount = rows.filter((r) => r.buy).length;
  const sellCount = rows.length - buyCount;
  const solVolume = rows.reduce((sum, r) => sum + (Number.isFinite(r.sol) ? Math.abs(r.sol) : 0), 0);
  const latestMcUsd = [...rows].reverse().find((r) => r.mcUsd != null)?.mcUsd ?? null;

  return {
    strategy: BUILTIN_SCALPER_STRATEGY,
    sampleSize: rows.length,
    buyCount,
    sellCount,
    solVolume,
    latestMcUsd,
    firstTradeTs: rows[0]?.ts ?? null,
    lastTradeTs: rows.at(-1)?.ts ?? null,
    snapshot,
    avgPnlPct: pnl.length ? pnl.reduce((sum, x) => sum + x, 0) / pnl.length : null,
    bestPnlPct: pnl.length ? Math.max(...pnl) : null,
    worstPnlPct: pnl.length ? Math.min(...pnl) : null,
    grossPaperSolNet,
  };
}

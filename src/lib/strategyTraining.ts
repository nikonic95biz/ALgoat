import type { ScalperUserConfig } from "@/context/AppContext";
import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import { replayBuiltInScalper } from "@/lib/strategyReplay";
import type { StrategyReplayResult } from "@/lib/strategyTypes";

export type TrainingVariant = {
  id: string;
  label: string;
  config: ScalperUserConfig;
  replay: StrategyReplayResult;
  score: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function scoreReplay(replay: StrategyReplayResult): number {
  const closed = replay.snapshot.closedTrades;
  const pnl = replay.snapshot.totalPnlPct;
  const winRate = replay.snapshot.winRate ?? 0;
  const tradePenalty = closed === 0 ? 50 : closed < 2 ? 8 : 0;
  return pnl + winRate * 0.08 + Math.min(closed, 10) * 0.75 - tradePenalty;
}

function uniqueVariants(variants: Array<{ id: string; label: string; config: ScalperUserConfig }>) {
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = JSON.stringify(v.config);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function runScalperTrainingSweep(input: {
  rows: PumpPortalLiveRow[];
  baseConfig: ScalperUserConfig;
  activeBounceZonePrices?: number[];
  paperBuySol?: number;
}): TrainingVariant[] {
  const { baseConfig } = input;
  const candidates = uniqueVariants([
    { id: "base", label: "Current", config: baseConfig },
    {
      id: "safer",
      label: "Safer",
      config: {
        ...baseConfig,
        catalystMinSol: Number(clamp(baseConfig.catalystMinSol * 1.35, 0.01, 50).toFixed(3)),
        minOrderBookSellSolForStop: Number(clamp(baseConfig.minOrderBookSellSolForStop * 1.4, 0.01, 50).toFixed(3)),
        takeProfitPct: Number(clamp(baseConfig.takeProfitPct * 0.85, 1, 200).toFixed(2)),
      },
    },
    {
      id: "faster",
      label: "Faster",
      config: {
        ...baseConfig,
        dipMinPct: Number(clamp(baseConfig.dipMinPct * 0.8, 1, 80).toFixed(2)),
        catalystMinSol: Number(clamp(baseConfig.catalystMinSol * 0.85, 0.01, 50).toFixed(3)),
        reentryCooldownMs: Math.round(clamp(baseConfig.reentryCooldownMs * 0.7, 0, 300000)),
      },
    },
    {
      id: "runner",
      label: "Runner",
      config: {
        ...baseConfig,
        takeProfitPct: Number(clamp(baseConfig.takeProfitPct * 1.35, 1, 200).toFixed(2)),
        minOrderBookSellSolForStop: Number(clamp(baseConfig.minOrderBookSellSolForStop * 0.8, 0.01, 50).toFixed(3)),
      },
    },
    {
      id: "deep-dip",
      label: "Deep dip",
      config: {
        ...baseConfig,
        dipMinPct: Number(clamp(baseConfig.dipMinPct * 1.25, 1, 80).toFixed(2)),
        catalystMinSol: Number(clamp(baseConfig.catalystMinSol * 1.1, 0.01, 50).toFixed(3)),
      },
    },
  ]);

  return candidates
    .map((candidate) => {
      const replay = replayBuiltInScalper({
        rows: input.rows,
        config: candidate.config,
        activeBounceZonePrices: input.activeBounceZonePrices,
        paperBuySol: input.paperBuySol,
      });
      return {
        ...candidate,
        replay,
        score: scoreReplay(replay),
      };
    })
    .sort((a, b) => b.score - a.score);
}

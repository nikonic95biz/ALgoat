import type { ScalperUserConfig } from "@/context/AppContext";
import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import type { ScalperPaperSnapshot } from "@/lib/scalperPaperEngine";

export type StrategyKind = "scalper";

export type StrategyKnobDefinition = {
  key: keyof ScalperUserConfig;
  label: string;
  unit: "%" | "SOL" | "ms";
  description: string;
};

export type StrategyDefinition = {
  id: string;
  name: string;
  kind: StrategyKind;
  description: string;
  sourcePath: string;
  paperSupported: boolean;
  liveSupported: boolean;
  knobs: StrategyKnobDefinition[];
};

export type StrategyReplayInput = {
  rows: PumpPortalLiveRow[];
  config: ScalperUserConfig;
  activeBounceZonePrices?: number[];
  paperBuySol?: number;
  minTradeTsMs?: number;
};

export type StrategyReplayResult = {
  strategy: StrategyDefinition;
  sampleSize: number;
  buyCount: number;
  sellCount: number;
  solVolume: number;
  latestMcUsd: number | null;
  firstTradeTs: number | null;
  lastTradeTs: number | null;
  snapshot: ScalperPaperSnapshot;
  avgPnlPct: number | null;
  bestPnlPct: number | null;
  worstPnlPct: number | null;
  grossPaperSolNet: number | null;
};

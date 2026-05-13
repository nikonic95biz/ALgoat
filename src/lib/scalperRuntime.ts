import type { ScalperUserConfig } from "@/context/AppContext";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import type { StrategyRuntime, StrategyRuntimeDefinition } from "@/lib/strategyRuntime";

export type ScalperRuntimeState = {
  startedAt: number | null;
  lastDecisionAt: number | null;
};

export const SCALPER_RUNTIME_DEFINITION: StrategyRuntimeDefinition<ScalperUserConfig> = {
  id: BUILTIN_SCALPER_PRESET_ID,
  name: "Order-book scalper",
  kind: "scalper",
  version: "1.0.0",
  description:
    "Arms after a market-cap dip and bounce-zone alignment, enters on a catalyst buy, then exits on take-profit or sell-pressure stop.",
  sourceFiles: [
    "src/lib/scalperPaperEngine.ts",
    "src/lib/scalperRuntime.ts",
    "src/components/CaChartPanel.tsx",
  ],
  supportedModes: ["replay", "paper", "live"],
  defaultConfig: SCALPER_PAPER_CONFIG,
  configFields: [
    {
      key: "dipMinPct",
      label: "Dip threshold",
      type: "number",
      unit: "%",
      min: 1,
      max: 80,
      step: 1,
      description: "Minimum pullback from recent peak before the strategy can arm.",
    },
    {
      key: "catalystMinSol",
      label: "Catalyst buy",
      type: "number",
      unit: "SOL",
      min: 0.01,
      max: 50,
      step: 0.05,
      description: "Minimum buy size that can trigger entry after the strategy is armed.",
    },
    {
      key: "takeProfitPct",
      label: "Take profit",
      type: "number",
      unit: "%",
      min: 1,
      max: 200,
      step: 1,
      description: "Market-cap gain from entry that closes a winning trade.",
    },
    {
      key: "minOrderBookSellSolForStop",
      label: "Sell-pressure stop",
      type: "number",
      unit: "SOL",
      min: 0.01,
      max: 50,
      step: 0.05,
      description: "Sell size that counts as an exit pressure signal.",
    },
    {
      key: "reentryCooldownMs",
      label: "Re-entry cooldown",
      type: "number",
      unit: "ms",
      min: 0,
      max: 300_000,
      step: 1_000,
      description: "Time to wait after a closed trade before another entry can fire.",
    },
  ],
};

export const scalperRuntime: StrategyRuntime<ScalperUserConfig, ScalperRuntimeState> = {
  definition: SCALPER_RUNTIME_DEFINITION,
  createInitialState: () => ({
    startedAt: null,
    lastDecisionAt: null,
  }),
  onDiscoveryEvent: (_ctx, state) => state,
  onTick: (_ctx, state) => state,
  onSessionStart: (ctx, state) => ({
    ...state,
    startedAt: ctx.now,
  }),
  onSessionStop: (_ctx, state) => ({
    ...state,
    startedAt: null,
  }),
};

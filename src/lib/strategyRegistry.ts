import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import { scalperRuntime } from "@/lib/scalperRuntime";
import type { StrategyRuntime } from "@/lib/strategyRuntime";
import type { StrategyDefinition } from "@/lib/strategyTypes";

export const BUILTIN_SCALPER_STRATEGY: StrategyDefinition = {
  id: BUILTIN_SCALPER_PRESET_ID,
  name: "Order-book scalper",
  kind: "scalper",
  description:
    "Arms after a market-cap dip and bounce-zone alignment, enters on a catalyst buy, then exits on take-profit or sell-pressure stop.",
  sourcePath: "src/lib/scalperPaperEngine.ts",
  paperSupported: true,
  liveSupported: true,
  knobs: [
    {
      key: "dipMinPct",
      label: "Dip threshold",
      unit: "%",
      description: "Minimum pullback from recent peak before the strategy can arm.",
    },
    {
      key: "catalystMinSol",
      label: "Catalyst buy",
      unit: "SOL",
      description: "Minimum buy size that can trigger entry after the strategy is armed.",
    },
    {
      key: "takeProfitPct",
      label: "Take profit",
      unit: "%",
      description: "Market-cap gain from entry that closes a winning paper trade.",
    },
    {
      key: "minOrderBookSellSolForStop",
      label: "Sell-pressure stop",
      unit: "SOL",
      description: "Sell size that counts as an exit signal.",
    },
    {
      key: "reentryCooldownMs",
      label: "Re-entry cooldown",
      unit: "ms",
      description: "Time to wait after a closed trade before another entry can fire.",
    },
  ],
};

export const STRATEGY_REGISTRY: StrategyDefinition[] = [
  BUILTIN_SCALPER_STRATEGY,
];

export const STRATEGY_RUNTIME_REGISTRY: StrategyRuntime<unknown, unknown>[] = [
  scalperRuntime as StrategyRuntime<unknown, unknown>,
];

export function getStrategyById(id: string | null | undefined): StrategyDefinition | null {
  if (!id) return null;
  return STRATEGY_REGISTRY.find((s) => s.id === id) ?? null;
}

export function getStrategyRuntimeById(id: string | null | undefined): StrategyRuntime<unknown, unknown> | null {
  if (!id) return null;
  return STRATEGY_RUNTIME_REGISTRY.find((s) => s.definition.id === id) ?? null;
}

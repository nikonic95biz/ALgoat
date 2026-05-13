import type { DiscoveryEvent } from "@/lib/discoveryTypes";

export type StrategyRunMode = "replay" | "paper" | "live";

export type StrategyRuntimeKind =
  | "scalper"
  | "zombie-sniper"
  | "graduation-sniper"
  | "volume-breakout"
  | "wallet-follow"
  | "custom";

export type StrategyConfigField = {
  key: string;
  label: string;
  type: "number" | "string" | "boolean" | "select";
  unit?: "%" | "SOL" | "ms" | "seconds" | "minutes" | "USD";
  min?: number;
  max?: number;
  step?: number;
  description: string;
};

export type StrategyRuntimeDefinition<TConfig = unknown> = {
  id: string;
  name: string;
  kind: StrategyRuntimeKind;
  version: string;
  description: string;
  sourceFiles: string[];
  supportedModes: StrategyRunMode[];
  configFields: StrategyConfigField[];
  defaultConfig: TConfig;
};

export type StrategyDecisionAction =
  | "watch"
  | "unwatch"
  | "enter"
  | "exit"
  | "skip"
  | "halt"
  | "note";

export type StrategyDecision = {
  id: string;
  strategyId: string;
  sessionId: string | null;
  mint: string | null;
  action: StrategyDecisionAction;
  reason: string;
  confidence: number;
  createdAt: number;
  relatedEventIds: string[];
  risk: {
    requiresApproval: boolean;
    maxSol: number | null;
  };
};

export type StrategyRuntimeContext = {
  strategyId: string;
  sessionId: string | null;
  mode: StrategyRunMode;
  now: number;
  requestWatch: (mint: string, reason: string, priority: number) => void;
  releaseWatch: (mint: string) => void;
  recordDecision: (decision: StrategyDecision) => void;
};

export type StrategyRuntime<TConfig, TState> = {
  definition: StrategyRuntimeDefinition<TConfig>;
  createInitialState: (config: TConfig) => TState;
  onDiscoveryEvent: (ctx: StrategyRuntimeContext, state: TState, config: TConfig, event: DiscoveryEvent) => TState;
  onTick: (ctx: StrategyRuntimeContext, state: TState, config: TConfig) => TState;
  onSessionStart: (ctx: StrategyRuntimeContext, state: TState, config: TConfig) => TState;
  onSessionStop: (ctx: StrategyRuntimeContext, state: TState, config: TConfig) => TState;
};

export function createStrategyDecision(input: Omit<StrategyDecision, "id" | "createdAt">): StrategyDecision {
  return {
    ...input,
    id: `${input.strategyId}:${input.action}:${input.mint ?? "global"}:${Date.now()}`,
    createdAt: Date.now(),
  };
}

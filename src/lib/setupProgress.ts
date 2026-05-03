import type { GitHubWorkspaceSettings, ModelSettings } from "@/types";
import {
  getEffectivePumpPortalApiKey,
  getPumpPortalTradingWalletPubkey,
  getPumpPortalWsMode,
} from "@/lib/pumpPortalConfig";
import { isLikelyLocalLlm, presetAllowsOptionalApiKey } from "@/lib/llmPresets";

export type SetupStepsDone = {
  pumpPortal: boolean;
  /** PumpPortal trading wallet secret (or legacy pasted pubkey) — SOL chip + live wallet identity in Setup. */
  pumpPortalWallet: boolean;
  llm: boolean;
  github: boolean;
};

const TOTAL_STEPS = 4;

export function computeSetupSteps(model: ModelSettings, github: GitHubWorkspaceSettings): SetupStepsDone {
  const pumpKey = getEffectivePumpPortalApiKey().trim();
  const wsMode = getPumpPortalWsMode();
  const pumpPortal = pumpKey.length > 0 || wsMode === "public-only";

  const pumpPortalWallet = getPumpPortalTradingWalletPubkey() != null;

  const llm =
    presetAllowsOptionalApiKey(model) ||
    isLikelyLocalLlm(model.baseUrl) ||
    model.apiKey.trim().length > 0;

  const githubDone =
    github.token.trim().length > 0 &&
    github.owner.trim().length > 0 &&
    github.repo.trim().length > 0;

  return { pumpPortal, pumpPortalWallet, llm, github: githubDone };
}

export function setupCompletedCount(steps: SetupStepsDone): number {
  let n = 0;
  if (steps.pumpPortal) n++;
  if (steps.pumpPortalWallet) n++;
  if (steps.llm) n++;
  if (steps.github) n++;
  return n;
}

export function isSetupComplete(steps: SetupStepsDone): boolean {
  return setupCompletedCount(steps) === TOTAL_STEPS;
}

export const SETUP_STEP_TOTAL = TOTAL_STEPS;

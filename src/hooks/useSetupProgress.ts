import { useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";
import {
  computeSetupSteps,
  isSetupComplete,
  setupCompletedCount,
  SETUP_STEP_TOTAL,
} from "@/lib/setupProgress";

export function useSetupProgress() {
  const { model, githubWorkspace } = useApp();
  const pumpRev = usePumpPortalConfigRevision();

  return useMemo(() => {
    const steps = computeSetupSteps(model, githubWorkspace);
    const done = setupCompletedCount(steps);
    const complete = isSetupComplete(steps);
    const missing: string[] = [];
    if (!steps.pumpPortal) missing.push("PumpPortal");
    if (!steps.pumpPortalWallet) missing.push("Trading wallet");
    if (!steps.llm) missing.push("LLM");
    if (!steps.github) missing.push("GitHub");

    return {
      steps,
      done,
      complete,
      missing,
      hint: complete ? "All set — keys stay only in this browser." : `Still need: ${missing.join(" · ")}`,
      total: SETUP_STEP_TOTAL,
    };
  }, [model, githubWorkspace, pumpRev]);
}

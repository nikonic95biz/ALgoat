import { useEffect, useState } from "react";
import { PUMPPORTAL_CONFIG_CHANGED_EVENT } from "@/lib/pumpPortalConfig";

/** Bump when PumpPortal env/storage changes so components re-read `getPumpPortalWsMode()` etc. */
export function usePumpPortalConfigRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const on = () => setRev((r) => r + 1);
    window.addEventListener(PUMPPORTAL_CONFIG_CHANGED_EVENT, on);
    return () => window.removeEventListener(PUMPPORTAL_CONFIG_CHANGED_EVENT, on);
  }, []);
  return rev;
}

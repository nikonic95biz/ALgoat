import type { CSSProperties } from "react";
import { useMemo } from "react";
import { PumpPortalWalletFundingBadge } from "@/components/PumpPortalWalletFundingBadge";
import { Tooltip } from "@/components/Tooltip";
import { useApp } from "@/context/AppContext";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";
import { usePumpPortalLinkedWalletSol } from "@/hooks/usePumpPortalLinkedWalletSol";
import { getPumpPortalTradingWalletPubkey } from "@/lib/pumpPortalConfig";

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const drag = { WebkitAppRegion: "drag" } as CSSProperties;

export function AppTopChrome() {
  const {
    sidebarOpen,
    setSidebarOpen,
    openSetupPanel,
  } = useApp();

  const pumpPortalRev = usePumpPortalConfigRevision();
  const topBarPortalLinkedPk = useMemo(() => getPumpPortalTradingWalletPubkey(), [pumpPortalRev]);
  const { sol: topBarPortalSol, loading: topBarPortalSolLoading } = usePumpPortalLinkedWalletSol(topBarPortalLinkedPk);

  return (
    <header className="flex min-h-11 shrink-0 border-b border-[color-mix(in_srgb,var(--color-border)_65%,#2EA8FF_18%)] bg-[var(--color-bg-titleBar)] shadow-[0_10px_32px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.055)]">
      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 py-2 sm:gap-3 sm:px-4">
        {/* Center wordmark */}
        <div className="min-w-0 flex flex-1 select-none items-center justify-start px-1 text-left sm:justify-center sm:px-4 sm:text-center" style={drag}>
          <span className="inline-flex items-center gap-1.5 truncate text-[13px] font-semibold tracking-[0.02em] text-[color-mix(in_srgb,var(--color-fg)_78%,#2EA8FF_22%)] drop-shadow-[0_0_14px_rgba(46,168,255,0.12)]">
            <img src="/algoat-logo.png" alt="" className="h-5 w-5 rounded-full object-cover opacity-90" />
            ALgoat
          </span>
        </div>

        {/* Right side: wallet balance + Setup + panel toggle */}
        <div className="ml-auto flex shrink-0 items-center gap-2" style={noDrag}>
          {topBarPortalLinkedPk ? (
            <Tooltip text={`PumpPortal wallet · ${topBarPortalLinkedPk.slice(0, 6)}…${topBarPortalLinkedPk.slice(-4)}`} side="bottom">
              <PumpPortalWalletFundingBadge sol={topBarPortalSol} loading={topBarPortalSolLoading} hasPubkey compact />
            </Tooltip>
          ) : null}

          <button
            type="button"
            onClick={openSetupPanel}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-[var(--color-fg-muted)] transition-colors hover:border-white/15 hover:text-[var(--color-fg)]"
          >
            Setup
          </button>

          <button
            type="button"
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="shrink-0 rounded-lg border border-white/12 bg-[color-mix(in_srgb,var(--color-fill)_45%,transparent)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-[color-mix(in_srgb,#2EA8FF_35%,white)] hover:text-[var(--color-fg)]"
          >
            {sidebarOpen ? "Hide panel" : "Show panel"}
          </button>
        </div>
      </div>
    </header>
  );
}

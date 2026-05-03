import { Loader2 } from "lucide-react";
import {
  PUMPPORTAL_MIN_LINKED_WALLET_SOL,
  isPumpPortalLinkedWalletFunded,
} from "@/lib/pumpPortalConfig";

function fmtSolUi(n: number): string {
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

export function PumpPortalWalletFundingBadge({
  sol,
  loading,
  hasPubkey,
  compact,
}: {
  sol: number | null;
  loading: boolean;
  hasPubkey: boolean;
  /** Narrow pill for top chrome */
  compact?: boolean;
}) {
  if (!hasPubkey) {
    return (
      <span
        className={
          "shrink-0 rounded-full border border-white/10 bg-[var(--color-fill)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-dim)] " +
          (compact ? "" : "max-w-[14rem]")
        }
        title="Add your PumpPortal wallet private key in Setup to show live SOL balance."
      >
        {compact ? "Portal wallet —" : "Portal wallet — add secret key in Setup"}
      </span>
    );
  }

  if (loading && sol === null) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-[var(--color-fill)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-muted)]">
        <Loader2 className="size-3 animate-spin opacity-70" aria-hidden />
        SOL…
      </span>
    );
  }

  if (sol === null) {
    return (
      <span
        className="shrink-0 rounded-full border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-100/90"
        title="Could not read balance — try another RPC (VITE_SOLANA_RPC_URL) or confirm the address."
      >
        SOL unreadable
      </span>
    );
  }

  const funded = isPumpPortalLinkedWalletFunded(sol);

  return (
    <span
      className={
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums " +
        (funded
          ? "border border-emerald-500/35 bg-emerald-500/15 text-emerald-200"
          : "border border-red-500/40 bg-red-500/15 text-red-100")
      }
      title={
        funded
          ? `Trading wallet reads ~${fmtSolUi(sol)} SOL — meets PumpPortal’s usual ~${PUMPPORTAL_MIN_LINKED_WALLET_SOL} SOL guideline (RPC rounding allowed).`
          : `Trading wallet reads ~${fmtSolUi(sol)} SOL — below PumpPortal’s usual ~${PUMPPORTAL_MIN_LINKED_WALLET_SOL} SOL floor; top up if streams fail. Empty tape can also be API/mint/subscription issues — see Setup debug hint.`
      }
    >
      {fmtSolUi(sol)} SOL · {funded ? "funded" : "low"}
    </span>
  );
}

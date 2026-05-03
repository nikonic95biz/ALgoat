import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";
import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import { formatMcUsdBook, formatSol } from "@/lib/formatUsd";
import { getPumpPortalWsMode } from "@/lib/pumpPortalConfig";

type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

const axTheme = {
  frame:
    "rounded-xl border border-cyan-400/25 bg-gradient-to-b from-[#12122a]/95 via-[#0c0c18] to-[#06060f] shadow-[0_0_0_1px_rgba(168,85,247,0.08),inset_0_1px_0_0_rgba(34,211,238,0.06)]",
};

function fmtPrintTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function PumpOrderBook({
  rows,
  state,
  error,
  yMcCap: _yMcCap,
}: {
  rows: PumpPortalLiveRow[];
  state: ConnState;
  error: string | null;
  yMcCap: boolean;
}) {
  void _yMcCap;

  usePumpPortalConfigRevision();
  const wsMode = getPumpPortalWsMode();
  const orderBookConfigHints =
    state === "open" && rows.length === 0 && !error
      ? wsMode === "anonymous"
        ? [
            "PumpPortal expects an API key for token trades. Paste your key in Setup (key icon), then Save — or set VITE_PUMPPORTAL_API_KEY in .env.local and restart.",
          ]
        : wsMode === "public-only"
          ? [
              "Public websocket mode (VITE_PUMPPORTAL_WS_PUBLIC_ONLY): prints are often missing. Unset it and use an API key for a full order book.",
            ]
          : wsMode === "api-key"
            ? [
                "Connected but no fills yet — not always wallet-related: wrong mint, PumpPortal-side limits, or a new JSON wrapper we don’t parse yet. Check red errors above; Setup has a websocket debug toggle.",
              ]
            : []
      : [];

  const statusText =
    state === "open"
      ? "LIVE"
      : state === "connecting"
        ? "CONN"
        : state === "closed"
          ? "RECONN"
          : state === "error"
            ? "ERR"
            : "OFF";

  return (
    <div className={`flex min-h-[220px] min-w-0 flex-1 flex-col overflow-hidden ${axTheme.frame}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-cyan-400/15 px-3 py-2">
        <div>
          <div className="bg-gradient-to-r from-teal-200 via-cyan-200 to-violet-200 bg-clip-text text-[15px] font-semibold tracking-tight text-transparent">
            Order book
          </div>
          <p className="mt-0.5 max-w-[32rem] text-[11px] leading-snug text-violet-200/45">
            PumpPortal trades for this mint
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-teal-400/30 bg-teal-500/10 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide text-teal-200/90">
          {statusText}
        </span>
      </div>
      {error ? (
        <div className="shrink-0 px-3 py-2 text-[13px] text-red-300/95">{error}</div>
      ) : null}
      {orderBookConfigHints.map((hint, i) => (
        <div
          key={`order-book-hint-${i}`}
          className="shrink-0 border-b border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100/90"
        >
          {hint}
        </div>
      ))}

      {rows.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-[#0a0a14]/90 px-2 py-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">
            Prints ({rows.length})
          </div>
          <div className="max-h-[min(50vh,420px)] min-h-[160px] space-y-0.5 overflow-y-auto font-mono text-[11px]">
            {rows.slice(0, 120).map((r) => (
              <div
                key={r.id}
                className="flex justify-between gap-2 border-b border-white/[0.04] py-0.5 text-violet-200/90"
              >
                <span className="shrink-0 text-violet-400/70">{fmtPrintTime(r.ts)}</span>
                <span className={r.buy ? "text-emerald-300" : "text-rose-300"}>
                  {r.buy ? "Buy" : "Sell"}
                </span>
                <span className="text-cyan-100/80">{formatSol(r.sol)}</span>
                <span className="shrink-0 text-right text-violet-300/80">
                  {r.mcUsd != null ? formatMcUsdBook(r.mcUsd) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : state === "open" && !error ? (
        <div className="flex min-h-[160px] flex-1 items-center justify-center px-3 py-6 text-center text-[11px] leading-relaxed text-violet-300/45">
          Waiting for trades on this mint… If the token is illiquid, prints may be sparse.
        </div>
      ) : null}
    </div>
  );
}

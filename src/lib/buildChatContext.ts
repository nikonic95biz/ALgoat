import type { ChartAnalyticsState, TradingMode } from "@/context/AppContext";
import type { ScalperPaperSnapshot } from "@/lib/scalperPaperEngine";
import type { UserAlgoPreset } from "@/types";
import { formatUsdCompact } from "@/lib/formatUsd";

const MAX_FILE_CONTENT_CHARS = 6_000;
const MAX_FILE_TREE_PATHS = 120;

export type LiveContextSnapshot = {
  chartAnalytics: ChartAnalyticsState;
  selectedAlgoId: string | null;
  userAlgos: UserAlgoPreset[];
  tradingMode: TradingMode;
  openFilePath: string | null;
  openFileContent: string | null;
  workspaceFilePaths: string[];
};

function scalperStatus(s: ScalperPaperSnapshot | null): string {
  if (!s) return "inactive";
  const pnl = s.currentTrade?.unrealizedPct != null ? ` (open PnL ${s.currentTrade.unrealizedPct.toFixed(2)}%)` : "";
  return `${s.status}${pnl} · ${s.closedTrades} closed trade(s) · total PnL ${s.totalPnlPct.toFixed(2)}%`;
}

function algoName(algos: UserAlgoPreset[], id: string | null): string {
  if (!id) return "none";
  return algos.find((a) => a.id === id)?.name ?? id;
}

export function buildLiveContext(snap: LiveContextSnapshot): string {
  const lines: string[] = ["## Live app state"];
  const ca = snap.chartAnalytics;

  lines.push(`- Chart mint (loaded or pending stream): ${ca.mint ?? "none"}`);
  lines.push(`- Selected algo: ${algoName(snap.userAlgos, snap.selectedAlgoId)}`);
  lines.push(`- Trading mode: ${snap.tradingMode}`);
  lines.push(`- Paper scalper: ${scalperStatus(ca.paperScalper)}`);
  if (snap.tradingMode === "real") {
    if (ca.livePumpPortalLastSig) {
      lines.push(`- Last Lightning tx (PumpPortal): ${ca.livePumpPortalLastSig}`);
    }
    if (ca.livePumpPortalLastErr) {
      lines.push(`- Live trading error: ${ca.livePumpPortalLastErr}`);
    }
  }

  lines.push("");
  lines.push("## Chart & PumpPortal tape (snapshot at send time)");
  lines.push(
    `- Chart fetch: ${ca.chartLoading ? "loading…" : "idle"}${ca.chartError ? ` · error: ${ca.chartError}` : ""}`,
  );
  lines.push(`- Candle interval: ${ca.chartInterval ?? "n/a"}`);
  lines.push(`- Y-axis mode: ${ca.yMcCap === null ? "n/a" : ca.yMcCap ? "market cap USD" : "price USD"}`);
  if (ca.tokenSupplyUi != null) {
    lines.push(`- Token supply (RPC, UI units): ${ca.tokenSupplyUi}`);
  }

  if (ca.lastCandle) {
    const c = ca.lastCandle;
    const unit = c.yAxisIsMarketCapUsd ? "MC USD" : "price USD";
    lines.push(
      `- Last candle (${c.interval}, ${unit}): O ${formatUsdCompact(c.open)} · H ${formatUsdCompact(c.high)} · L ${formatUsdCompact(c.low)} · C ${formatUsdCompact(c.close)} · bar ${new Date(c.timeUnix * 1000).toISOString()}`,
    );
  } else {
    lines.push("- Last candle: (none — chart still loading or no candles yet)");
  }

  lines.push(
    `- PumpPortal trade stream: ${ca.orderBookConn}${ca.orderBookError ? ` · ${ca.orderBookError}` : ""}`,
  );

  if (ca.tapeSummary) {
    const t = ca.tapeSummary;
    lines.push(
      `- Tape buffer (${t.sampleSize} prints): buys ${t.buyCount} · sells ${t.sellCount} · Σ SOL ${t.solVolume.toFixed(4)}`,
    );
    lines.push(
      `- Latest MC USD from tape: ${t.latestMcUsd != null ? formatUsdCompact(t.latestMcUsd) : "not reported on recent prints"}`,
    );
    if (t.recentPrints.length > 0) {
      lines.push("- Recent prints (newest first):");
      for (const p of t.recentPrints) {
        lines.push(
          `  - ${new Date(p.ts).toISOString()} · ${p.buy ? "buy" : "sell"} · ${p.sol.toFixed(4)} SOL · MC ${p.mcUsd != null ? formatUsdCompact(p.mcUsd) : "—"}`,
        );
      }
    }
  } else {
    lines.push("- Tape snapshot: n/a");
  }

  lines.push("");

  if (snap.openFilePath && snap.openFileContent != null) {
    const content =
      snap.openFileContent.length > MAX_FILE_CONTENT_CHARS
        ? snap.openFileContent.slice(0, MAX_FILE_CONTENT_CHARS) + "\n… (truncated)"
        : snap.openFileContent;
    const ext = snap.openFilePath.split(".").pop() ?? "";
    const lang = extToLang(ext);
    lines.push("## Open file in Code editor");
    lines.push(`Path: ${snap.openFilePath}`);
    lines.push("```" + lang);
    lines.push(content);
    lines.push("```");
  } else {
    lines.push("## Open file in Code editor");
    lines.push("None open.");
  }

  if (snap.workspaceFilePaths.length > 0) {
    lines.push("");
    lines.push(`## File tree (${Math.min(snap.workspaceFilePaths.length, MAX_FILE_TREE_PATHS)} of ${snap.workspaceFilePaths.length} paths)`);
    lines.push(snap.workspaceFilePaths.slice(0, MAX_FILE_TREE_PATHS).join("\n"));
  }

  return lines.join("\n");
}

function extToLang(ext: string): string {
  switch (ext.toLowerCase()) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

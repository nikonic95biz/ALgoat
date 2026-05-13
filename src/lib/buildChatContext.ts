import type { ChartAnalyticsState, TradingMode, UserBounceZone, ScalperUserConfig } from "@/context/AppContext";
import type { ScalperPaperSnapshot } from "@/lib/scalperPaperEngine";
import type { AlgoBlueprint, TradingSessionRecord, UserAlgoPreset } from "@/types";
import { formatUsdCompact } from "@/lib/formatUsd";

const MAX_FILE_CONTENT_CHARS = 6_000;
const MAX_FILE_TREE_PATHS = 120;

export type LiveContextOptions = {
  includeTradingDetails?: boolean;
  includeSessionDetails?: boolean;
  includeWorkspaceDetails?: boolean;
  includeOpenFile?: boolean;
};

export type LiveContextSnapshot = {
  chartAnalytics: ChartAnalyticsState;
  selectedAlgoId: string | null;
  userAlgos: UserAlgoPreset[];
  tradingMode: TradingMode;
  openFilePath: string | null;
  openFileContent: string | null;
  workspaceFilePaths: string[];
  bounceZones?: UserBounceZone[];
  scalperUserConfig?: ScalperUserConfig;
  algoSessionActive?: boolean;
  tradingHalted?: boolean;
  scalperLiveBuySol?: number;
  tradingSessions?: TradingSessionRecord[];
  algoBlueprints?: AlgoBlueprint[];
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

export function buildLiveContext(snap: LiveContextSnapshot, options: LiveContextOptions = {}): string {
  const {
    includeTradingDetails = true,
    includeSessionDetails = true,
    includeWorkspaceDetails = true,
    includeOpenFile = true,
  } = options;
  const lines: string[] = ["## Live app state"];
  const ca = snap.chartAnalytics;

  lines.push(`- Chart mint (loaded or pending stream): ${ca.mint ?? "none"}`);
  lines.push(`- Selected algo: ${algoName(snap.userAlgos, snap.selectedAlgoId)}`);
  lines.push(`- Trading mode: ${snap.tradingMode}`);
  if (snap.algoSessionActive !== undefined) {
    lines.push(`- Algo session: ${snap.algoSessionActive ? "ACTIVE" : "stopped"}${snap.tradingHalted ? " · ⚠️ HALTED (kill switch triggered)" : ""}`);
  }
  if (snap.tradingMode === "real" && snap.scalperLiveBuySol !== undefined && snap.scalperLiveBuySol > 0) {
    lines.push(`- Live buy size: ${snap.scalperLiveBuySol} SOL`);
  }
  lines.push(`- Paper scalper: ${scalperStatus(ca.paperScalper)}`);
  lines.push("");
  lines.push("## ALgoat app map");
  lines.push("- Trading tab: select an algo preset and run named paper/real trading sessions.");
  lines.push("- Algo Lab tab: create, view, delete, edit, and train algo blueprints/presets. Put strategy-specific UI here.");
  lines.push("- Performance tab: inspect saved trading-session files by preset/session and use results to improve algos.");

  if (snap.algoBlueprints && snap.algoBlueprints.length > 0) {
    lines.push("");
    lines.push("## Algo Lab blueprints");
    for (const b of snap.algoBlueprints.slice(0, 8)) {
      lines.push(`- ${b.name} (${b.status}) · goal: ${b.goal}`);
      lines.push(`  market: ${b.universe.length ? b.universe.join(", ") : "not set"} · signals: ${b.signals.length ? b.signals.join(", ") : "not set"}`);
      lines.push(`  entry: ${b.entryRules.length ? b.entryRules.join("; ") : "not set"} · exit: ${b.exitRules.length ? b.exitRules.join("; ") : "not set"}`);
      lines.push(`  implementation: preset ${b.implementation.presetId ?? "none"} · runnable ${b.implementation.runnable ? "yes" : "no"}`);
    }
  }

  if (includeTradingDetails && snap.bounceZones && ca.mint) {
    const mintZones = snap.bounceZones.filter((z) => z.mint === ca.mint);
    if (mintZones.length > 0) {
      const active = mintZones.filter((z) => z.enabled);
      lines.push(
        `- Chart bounce lines for this coin: ${mintZones.length} saved, ${active.length} turned on` +
        (active.length > 0
          ? " — " + active.map((z) => `$${z.price.toFixed(2)}${z.touches > 0 ? ` (touched ${z.touches}x)` : " (you drew this)"}`).join(", ")
          : "")
      );
    } else {
      lines.push(`- Chart bounce lines: none saved for this coin yet`);
    }
  }
  if (snap.scalperUserConfig) {
    const c = snap.scalperUserConfig;
    lines.push(
      `- Built-in scalper knobs (reference only; do not force these onto unrelated strategies): dip ${c.dipMinPct}% · catalyst ${c.catalystMinSol} SOL · TP +${c.takeProfitPct}% · stop sell ${c.minOrderBookSellSolForStop} SOL`,
    );
    if (snap.tradingMode === "real") {
      lines.push(
        `- Built-in scalper live settings (reference only): slippage ${c.realSlippagePct}% · priority fee ${c.realPriorityFeeSol} SOL`,
      );
    }
  }
  if (includeTradingDetails && snap.tradingMode === "real") {
    if (ca.livePumpPortalLastSig) {
      lines.push(`- Last Lightning tx (PumpPortal): ${ca.livePumpPortalLastSig}`);
    }
    if (ca.livePumpPortalLastErr) {
      lines.push(`- Live trading error: ${ca.livePumpPortalLastErr}`);
    }
    const legs = ca.realBotTrades.filter((r) => r.kind === "chain");
    if (legs.length > 0) {
      const net = legs.reduce((s, r) => s + r.netSol, 0);
      lines.push(
        `- On-chain scalper legs (this session): ${legs.length} · wallet net Σ SOL ${net >= 0 ? "+" : ""}${net.toFixed(4)}`,
      );
    }
  }

  if (includeSessionDetails && snap.tradingSessions && snap.tradingSessions.length > 0) {
    lines.push("");
    lines.push("## Saved trading sessions");
    for (const s of snap.tradingSessions.slice(0, 5)) {
      const trades = s.trades.length;
      const wins = s.trades.filter((t) => (t.pnlPct ?? t.netSol ?? 0) > 0).length;
      const pnl = s.trades.filter((t) => t.pnlPct != null).reduce((sum, t) => sum + (t.pnlPct ?? 0), 0);
      const netSol = s.trades.filter((t) => t.netSol != null).reduce((sum, t) => sum + (t.netSol ?? 0), 0);
      lines.push(
        `- ${s.name} (${s.mode}, ${s.status}) · preset ${s.presetName} · mint ${s.mint ?? "none"} · trades ${trades} · wins ${wins}` +
        (trades ? ` · pnl Σ ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}% · net SOL ${netSol >= 0 ? "+" : ""}${netSol.toFixed(4)}` : ""),
      );
      lines.push(
        `  config snapshot (preset-specific): ${JSON.stringify(s.configSnapshot).slice(0, 380)}${JSON.stringify(s.configSnapshot).length > 380 ? "…" : ""}`,
      );
      if (s.trades.length > 0) {
        const recentTrades = s.trades.slice(-5).map((t) =>
          `${new Date(t.closedAtTs).toISOString()} ${t.kind} ${t.exitReason} pnl ${t.pnlPct == null ? "n/a" : `${t.pnlPct.toFixed(2)}%`} netSOL ${t.netSol == null ? "n/a" : t.netSol.toFixed(4)}`,
        );
        lines.push(`  recent trades: ${recentTrades.join(" | ")}`);
      }
    }
  }

  if (includeTradingDetails) {
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
  }

  lines.push("");

  if (includeOpenFile && snap.openFilePath && snap.openFileContent != null) {
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

  if (includeWorkspaceDetails && snap.workspaceFilePaths.length > 0) {
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

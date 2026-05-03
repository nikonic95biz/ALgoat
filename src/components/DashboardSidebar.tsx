import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BotTradesBook } from "@/components/BotTradesBook";
import { InlineToolbarPicker } from "@/components/InlineToolbarPicker";
import { Tooltip } from "@/components/Tooltip";
import { useApp, type TradingMode } from "@/context/AppContext";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import {
  appendPumpPortalTradingWalletHint,
  getEffectivePumpPortalApiKey,
  getPumpPortalTradingWalletPubkey,
} from "@/lib/pumpPortalConfig";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import { formatUsdCompact } from "@/lib/formatUsd";
import type { ScalperPaperSnapshot } from "@/lib/scalperPaperEngine";
import { SetupPanel } from "@/components/SetupPanel";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";

/** Empty BotTradesBook copy follows engine phase — exit wording only once you're in a trade. */
function botTradesBookEmptyHint(snapshot: ScalperPaperSnapshot | null | undefined): string {
  const minBuy = SCALPER_PAPER_CONFIG.catalystMinSol;
  const tp = SCALPER_PAPER_CONFIG.takeProfitPct;
  const stopSol = SCALPER_PAPER_CONFIG.minOrderBookSellSolForStop;

  if (!snapshot) {
    return "No closed trades yet. Stream is up — dip and entry status shows above; completed exits land here.";
  }

  if (snapshot.status === "watching") {
    return `No closed trades yet. You're flat — watching for a dip, then a ${minBuy}+ SOL buy on the tape to enter.`;
  }

  if (snapshot.status === "dip") {
    return `No closed trades yet. Dip active — waiting for a ${minBuy}+ SOL buy on the tape to enter.`;
  }

  return `No closed trades yet. You're in an open trade; completed round-trips appear here after exit (+${tp}% take-profit or stop when the tape shows a ${stopSol}+ SOL sell).`;
}

export function DashboardSidebar() {
  const { sidebarMode } = useApp();
  if (sidebarMode === "analytics") return <AnalyticsPanel />;
  if (sidebarMode === "code") return <WorkspacePanel />;
  return <SetupPanel />;
}

function AnalyticsPanel() {
  const {
    selectedAlgoId,
    setSelectedAlgoId,
    userAlgos,
    chartAnalytics,
    tradingMode,
    setTradingMode,
    algoSessionActive,
    setAlgoSessionActive,
    setTradingHalted,
    hardStopTrading,
    scalperLiveBuySol,
    setScalperLiveBuySol,
  } = useApp();

  const pumpCfgRev = usePumpPortalConfigRevision();
  const tradingWalletPk = useMemo(() => getPumpPortalTradingWalletPubkey(), [pumpCfgRev]);

  const [tradingNotice, setTradingNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!tradingNotice) return;
    const tick = window.setTimeout(() => setTradingNotice(null), 5200);
    return () => window.clearTimeout(tick);
  }, [tradingNotice]);

  useEffect(() => {
    if (!algoSessionActive) return;
    if (selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID) {
      setAlgoSessionActive(false);
    }
  }, [algoSessionActive, selectedAlgoId, setAlgoSessionActive]);

  const presetGroups = useMemo(() => {
    const builtin = {
      heading: "Built-in",
      items: [{ value: BUILTIN_SCALPER_PRESET_ID, label: "Order-book scalper" }],
    };
    if (userAlgos.length === 0) return [builtin];
    return [
      builtin,
      { heading: "Your algos", items: userAlgos.map((a) => ({ value: a.id, label: a.name })) },
    ];
  }, [userAlgos]);

  const selectedUser = userAlgos.find((a) => a.id === selectedAlgoId);
  const canRunBundledScalper = selectedAlgoId === BUILTIN_SCALPER_PRESET_ID;
  const scalperEngineActive =
    algoSessionActive &&
    (tradingMode === "paper" || tradingMode === "real") &&
    selectedAlgoId === BUILTIN_SCALPER_PRESET_ID;

  const presetPickerDisplay = scalperEngineActive
    ? tradingMode === "real"
      ? "Live scalper (PumpPortal Lightning)"
      : "Paper scalper (order-book engine)"
    : undefined;

  const userAlgoDescription = selectedUser?.description?.trim() ? selectedUser.description : null;

  const sessionStripError =
    tradingMode === "real" && algoSessionActive && chartAnalytics.livePumpPortalLastErr;

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden"
      style={{ background: "var(--color-bg-sideBar)" }}
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden unt-panel-inner">
        <section className="unt-section-card space-y-4">
          <div>
            <h2 className="unt-section-title">Algo trading</h2>
            <p className="unt-help-text mt-2">
              Pick your algo preset, and start trading. If you&apos;d like a new preset, create it in chat.
            </p>
          </div>
          <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
            <label className="unt-field-label" htmlFor="ca-preset-trigger">
              Preset
            </label>
            <InlineToolbarPicker
              id="ca-preset"
              value={selectedAlgoId ?? ""}
              onChange={(v) => setSelectedAlgoId(v === "" ? null : v)}
              groups={presetGroups}
              displayValue={presetPickerDisplay}
              placeholder="Choose an algo…"
              aria-label="Algorithm preset"
            />

            {selectedAlgoId === BUILTIN_SCALPER_PRESET_ID ? (
              <div className="mt-3">
                <ScalperPaperPanel
                  snapshot={chartAnalytics.paperScalper}
                  mint={chartAnalytics.mint}
                  orderBookConn={chartAnalytics.orderBookConn}
                  paperSessionActive={
                    algoSessionActive && (tradingMode === "paper" || tradingMode === "real")
                  }
                  tradingMode={tradingMode}
                  liveEntrySol={scalperLiveBuySol}
                />
              </div>
            ) : selectedAlgoId != null ? (
              <div className="mt-3 space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
                <h3 className="unt-section-overline">Algo details</h3>
                {userAlgoDescription ? (
                  <p className="unt-body-text text-[var(--color-fg-muted)]">{userAlgoDescription}</p>
                ) : (
                  <p className="unt-help-text">No description on this preset yet — you can add one when saving from chat.</p>
                )}
              </div>
            ) : (
              <p className="unt-help-text mt-3 border-t border-[var(--color-border-subtle)] pt-3">
                Choose a preset to see what it does.
              </p>
            )}
          </div>

          <div
            className={
              "space-y-2 border-t border-[var(--color-border-subtle)] pt-4 " +
              (sessionStripError
                ? "rounded-lg bg-[color-mix(in_srgb,red_8%,transparent)] p-3 ring-1 ring-red-500/30"
                : tradingMode === "real" && algoSessionActive
                  ? "rounded-lg bg-[color-mix(in_srgb,#f59e0b_7%,transparent)] p-3 ring-1 ring-amber-500/25"
                  : "")
            }
          >
            {canRunBundledScalper ? (
              <div className="space-y-2 pb-1">
                <Tooltip text="How much SOL to spend per trade when running in Real mode. Locked while a session is active." side="right">
                  <label className="unt-field-label cursor-default" htmlFor="scalper-live-entry-sol">
                    Live entry size (SOL)
                  </label>
                </Tooltip>
                <input
                  id="scalper-live-entry-sol"
                  type="number"
                  inputMode="decimal"
                  min={0.001}
                  max={25}
                  step={0.001}
                  value={scalperLiveBuySol}
                  onChange={(e) => setScalperLiveBuySol(Number(e.target.value))}
                  disabled={algoSessionActive}
                  title={algoSessionActive ? "Stop the session to change live entry size" : undefined}
                  className="unt-input h-9 w-full max-w-[11rem] font-mono text-[13px] tabular-nums"
                />
                <p className="unt-help-text break-all font-mono text-[11px] text-[var(--color-fg-muted)]">
                  Trading wallet : {tradingWalletPk ?? "—"}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="unt-section-overline mb-0">Trading session</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Paper: simulated trades with no real money. Real: live Lightning trades via PumpPortal using your trading wallet." side="top">
              <select
                id="trading-mode-select"
                value={tradingMode}
                onChange={(e) => setTradingMode(e.target.value === "real" ? "real" : "paper")}
                aria-label="Trading mode"
                className={
                  "unt-select-trading shrink-0 " +
                  (tradingMode === "real"
                    ? sessionStripError
                      ? "border-red-500/40 text-red-100/95"
                      : "border-amber-500/35 text-amber-50/95"
                    : "")
                }
                disabled={algoSessionActive}
                title={algoSessionActive ? "Stop the session to change mode" : undefined}
              >
                <option value="paper">Paper trading</option>
                <option value="real">Real trading</option>
              </select>
              </Tooltip>
              {algoSessionActive ? (
                <span
                  className={
                    "min-w-0 text-[13px] font-semibold " +
                    (tradingMode === "real"
                      ? sessionStripError
                        ? "text-red-100/90"
                        : "text-amber-100/90"
                      : "text-teal-200/90")
                  }
                >
                  {tradingMode === "real" ? "Real trading live" : "Paper trading live"}
                </span>
              ) : null}
              <Tooltip
                text={
                  algoSessionActive
                    ? "Stop the current trading session immediately"
                    : !canRunBundledScalper
                      ? "Select the Order-book scalper preset first"
                      : tradingMode === "real"
                        ? "Start live trading — uses your PumpPortal wallet"
                        : "Start paper trading — no real money used"
                }
                side="top"
              >
              <button
                type="button"
                className="unt-btn-primary shrink-0 px-4 py-2 text-[13px] font-medium"
                disabled={!algoSessionActive && !canRunBundledScalper}
                onClick={() => {
                  if (algoSessionActive) {
                    hardStopTrading();
                    return;
                  }
                  if (!canRunBundledScalper) return;
                  if (tradingMode === "real" && !getEffectivePumpPortalApiKey().trim()) {
                    setTradingNotice(
                      appendPumpPortalTradingWalletHint(
                        "PumpPortal API key missing — add it in Setup.",
                      ),
                    );
                    return;
                  }
                  setTradingHalted(false);
                  setAlgoSessionActive(true);
                }}
              >
                {algoSessionActive ? "Stop" : "Start"}
              </button>
              </Tooltip>
            </div>
            {tradingNotice ? (
              <p className="unt-help-text whitespace-pre-wrap font-medium text-amber-400/90">{tradingNotice}</p>
            ) : (
              <p className="unt-help-text">
                Real mode needs a funded PumpPortal wallet (Setup). Chart uses the same Start/Stop.
              </p>
            )}
            {!algoSessionActive && !canRunBundledScalper && selectedAlgoId != null ? (
              <p className="unt-help-text">
                Switch to <strong className="font-semibold text-[var(--color-fg-muted)]">Order-book scalper</strong> to run this session.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-4">
            <h3 className="unt-section-overline">Live bot trades</h3>
            {!algoSessionActive ? (
              <p className="unt-help-text">
                Start with Order-book scalper + Chart mint to log bot fills here.
              </p>
            ) : selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID ? (
              <p className="unt-help-text">
                Select Order-book scalper above, then <strong className="font-semibold text-[var(--color-fg-muted)]">Start</strong>.
              </p>
            ) : !chartAnalytics.mint ? (
              <p className="unt-help-text">
                Add a mint on Chart so the scalper sees the book.
              </p>
            ) : chartAnalytics.orderBookConn !== "open" ? (
              <p className="unt-help-text">
                Order book: {chartAnalytics.orderBookConn}. Need live PumpPortal stream on Chart.
              </p>
            ) : tradingMode === "real" ? (
              <>
                {chartAnalytics.livePumpPortalLastErr ? (
                  <p className="unt-help-text whitespace-pre-wrap font-medium text-red-400/92">
                    {chartAnalytics.livePumpPortalLastErr}
                  </p>
                ) : null}
                {chartAnalytics.livePumpPortalLastSig ? (
                  <p className="unt-help-text break-all font-mono text-[11px] text-emerald-400/85">
                    Last Lightning tx: {chartAnalytics.livePumpPortalLastSig}
                  </p>
                ) : null}
                <p className="unt-help-text">
                  Live mode uses PumpPortal for trades; sells follow the same exit rules as paper. Buys use{" "}
                  {scalperLiveBuySol} SOL each (Live entry size above).
                </p>
                <BotTradesBook
                  rows={chartAnalytics.paperScalper?.botTrades ?? []}
                  emptyHint={botTradesBookEmptyHint(chartAnalytics.paperScalper)}
                />
              </>
            ) : (
              <BotTradesBook
                rows={chartAnalytics.paperScalper?.botTrades ?? []}
                emptyHint={botTradesBookEmptyHint(chartAnalytics.paperScalper)}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScalperPaperRules({
  tradingMode,
  liveEntrySol,
}: {
  tradingMode: TradingMode;
  liveEntrySol: number;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] px-2 py-2">
      <div className="text-[11px] font-semibold text-[var(--color-fg-muted)]">
        {tradingMode === "real"
          ? "How the Order-book scalper works (live trades use PumpPortal)"
          : "How the Order-book scalper works"}
      </div>
      <ul className="mt-1.5 list-inside list-disc space-y-1 text-[11px] leading-snug text-[var(--color-fg-dim)]">
        <li>
          Calls it a <span className="text-[var(--color-fg-muted)]">dip</span> when market cap drops more than{" "}
          {SCALPER_PAPER_CONFIG.dipMinPct}% below the recent high. After you close a trade, that high resets to the exit level.
        </li>
        <li>
          <span className="text-[var(--color-fg-muted)]">Opens a buy</span> when one tape print shows a buy larger than{" "}
          {SCALPER_PAPER_CONFIG.catalystMinSol} SOL.
        </li>
        <li>
          <span className="text-[var(--color-fg-muted)]">Stop-loss</span> when the tape shows a sell of at least{" "}
          {SCALPER_PAPER_CONFIG.minOrderBookSellSolForStop} SOL (very small sells are ignored).
        </li>
        <li>
          <span className="text-[var(--color-fg-muted)]">Takes profit</span> when market cap is up {SCALPER_PAPER_CONFIG.takeProfitPct}% from entry.
          Then waits{" "}
          {(SCALPER_PAPER_CONFIG.reentryCooldownMs / 1000).toLocaleString(undefined, {
            maximumFractionDigits: 1,
            minimumFractionDigits: 0,
          })}
          s before it can enter again.
        </li>
        {tradingMode === "real" ? (
          <li>
            <span className="text-[var(--color-fg-muted)]">Live Lightning buys</span> use ~{liveEntrySol} SOL per entry
            (Trading session · Live entry size).
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function ScalperPaperPanel({
  snapshot,
  mint,
  orderBookConn,
  paperSessionActive,
  tradingMode,
  liveEntrySol,
}: {
  snapshot: ScalperPaperSnapshot | null;
  mint: string | null;
  orderBookConn: "idle" | "connecting" | "open" | "closed" | "error";
  paperSessionActive: boolean;
  tradingMode: TradingMode;
  liveEntrySol: number;
}) {
  const wrap = (belowRules: ReactNode) => (
    <div
      className="space-y-3 rounded-lg border border-[var(--color-border-subtle)] px-3 py-3 text-[12px]"
      style={{ background: "var(--color-fill)" }}
    >
      <ScalperPaperRules tradingMode={tradingMode} liveEntrySol={liveEntrySol} />
      {belowRules}
    </div>
  );

  if (!paperSessionActive) {
    return wrap(
      <p className="unt-help-text">
        Press <strong className="font-semibold text-[var(--color-fg-muted)]">Start</strong> under Trading session, then load a mint on Chart so the order book can stream — stats appear below once it&apos;s live.
      </p>,
    );
  }
  if (!mint) {
    return wrap(
      <p className="unt-help-text">
        Load Chart with this mint so the book can stream.
      </p>,
    );
  }
  if (orderBookConn !== "open") {
    return wrap(
      <p className="unt-help-text">
        Order book: {orderBookConn}. Chart needs a live stream for this mint.
      </p>,
    );
  }
  if (!snapshot) {
    return wrap(<p className="unt-help-text">Waiting for trade rows…</p>);
  }

  const st =
    snapshot.status === "watching"
      ? "Watching"
      : snapshot.status === "dip"
        ? `Dip — waiting for a ${SCALPER_PAPER_CONFIG.catalystMinSol}+ SOL buy on the tape`
        : "In a trade";

  return wrap(
    <>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Status</span>
        <span className="text-[var(--color-fg)]">{st}</span>
      </div>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Win rate</span>
        <span className="text-[var(--color-fg)]">
          {snapshot.winRate != null ? snapshot.winRate.toFixed(1) + "%" : "—"}
        </span>
      </div>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>PnL (sum %)</span>
        <span className={snapshot.totalPnlPct >= 0 ? "text-emerald-300" : "text-red-400"}>
          {(snapshot.totalPnlPct >= 0 ? "+" : "") + snapshot.totalPnlPct.toFixed(2) + "%"}
        </span>
      </div>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Closed trades</span>
        <span className="text-[var(--color-fg)]">{snapshot.closedTrades}</span>
      </div>
      <div className="border-t border-[var(--color-border-subtle)] pt-2">
        <div className="unt-section-overline">Current trade</div>
      </div>
      {snapshot.currentTrade ? (
        <div className="space-y-1 text-[11px] leading-snug text-[var(--color-fg-muted)]">
          <div>Entry MC {formatUsdCompact(snapshot.currentTrade.entryMcUsd)}</div>
          <div>Catalyst {snapshot.currentTrade.catalystSol.toFixed(2)} SOL</div>
          {snapshot.currentTrade.lastMcUsd != null ? (
            <div>Last MC {formatUsdCompact(snapshot.currentTrade.lastMcUsd)}</div>
          ) : null}
          {snapshot.currentTrade.unrealizedPct != null ? (
            <div>
              Unrealized{" "}
              <span
                className={
                  snapshot.currentTrade.unrealizedPct >= 0 ? "text-emerald-300" : "text-red-400"
                }
              >
                {(snapshot.currentTrade.unrealizedPct >= 0 ? "+" : "") +
                  snapshot.currentTrade.unrealizedPct.toFixed(2) +
                  "%"}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--color-fg-dim)]">Flat</div>
      )}
    </>,
  );
}

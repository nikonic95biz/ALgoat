import { useEffect, useMemo, useState } from "react";
import { BotTradesBook } from "@/components/BotTradesBook";
import { InlineToolbarPicker } from "@/components/InlineToolbarPicker";
import { StreamHealthBanner } from "@/components/StreamHealthBanner";
import { Tooltip } from "@/components/Tooltip";
import { useApp, type TradingMode, type UserBounceZone } from "@/context/AppContext";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import {
  appendPumpPortalTradingWalletHint,
  getEffectivePumpPortalApiKey,
  getPumpPortalTradingWalletPubkey,
} from "@/lib/pumpPortalConfig";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import { formatUsdCompact, formatSol } from "@/lib/formatUsd";
import {
  isBotTradeChain,
  type BotTradeRow,
  type BotTradeRowTape,
  type ScalperPaperSnapshot,
} from "@/lib/scalperPaperEngine";
import { SetupPanel } from "@/components/SetupPanel";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { AlgoTabs, type AlgoTab } from "@/components/AlgoTabs";
import { TrainingDataPanel } from "@/components/TrainingDataPanel";
import { PerformancePanel } from "@/components/PerformancePanel";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";

/** Empty BotTradesBook copy follows engine phase — exit wording only once you're in a trade. */
function botTradesBookEmptyHint(snapshot: ScalperPaperSnapshot | null | undefined, cfg?: { catalystMinSol: number; takeProfitPct: number; minOrderBookSellSolForStop: number }): string {
  const minBuy = cfg?.catalystMinSol ?? SCALPER_PAPER_CONFIG.catalystMinSol;
  const tp = cfg?.takeProfitPct ?? SCALPER_PAPER_CONFIG.takeProfitPct;
  const stopSol = cfg?.minOrderBookSellSolForStop ?? SCALPER_PAPER_CONFIG.minOrderBookSellSolForStop;

  if (!snapshot) {
    return "No closed trades yet. When you finish a trade, it shows up here.";
  }

  if (snapshot.status === "watching") {
    return `No closed trades yet. Watching for a dip — after that the next ${minBuy}+ SOL buy triggers entry.`;
  }

  if (snapshot.status === "nearing") {
    return `No closed trades yet. Price is pulling back toward a bounce zone. Not armed yet — full dip + zone alignment needed before we arm and wait for a catalyst buy.`;
  }

  if (snapshot.status === "dip") {
    return `No closed trades yet. Price is dipped but bounce zones aren’t aligned yet (or we’re still scanning). When alignment hits we arm; then the next ${minBuy}+ SOL buy fires the entry.`;
  }

  if (snapshot.status === "arming") {
    return `No closed trades yet. Armed — dip + zones locked in. The next ${minBuy}+ SOL buy on tape should trigger entry immediately after that print.`;
  }

  return `No closed trades yet. You’re in a trade right now. Finished trades show here after we sell for +${tp}% profit, or after someone sells at least ${stopSol} SOL (that counts as our stop).`;
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
    algoBlueprints,
    focusedAlgoLabPresetId,
    chartAnalytics,
    tradingMode,
    setTradingMode,
    algoSessionActive,
    setAlgoSessionActive,
    setTradingHalted,
    startTradingSessionRecord,
    hardStopTrading,
    scalperLiveBuySol,
    setScalperLiveBuySol,
    scalperUserConfig,
    requestManualSell,
  } = useApp();

  const pumpCfgRev = usePumpPortalConfigRevision();
  const tradingWalletPk = useMemo(() => getPumpPortalTradingWalletPubkey(), [pumpCfgRev]);

  const [tradingNotice, setTradingNotice] = useState<string | null>(null);
  const [namingSessionOpen, setNamingSessionOpen] = useState(false);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [activeAlgoTab, setActiveAlgoTab] = useState<AlgoTab>("trading");
  useEffect(() => {
    if (!tradingNotice) return;
    const tick = window.setTimeout(() => setTradingNotice(null), 5200);
    return () => window.clearTimeout(tick);
  }, [tradingNotice]);

  useEffect(() => {
    if (!algoSessionActive) return;
    const selectedUser = userAlgos.find((a) => a.id === selectedAlgoId);
    if (selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID && selectedUser?.strategyId !== BUILTIN_SCALPER_PRESET_ID) {
      setAlgoSessionActive(false);
    }
  }, [algoSessionActive, selectedAlgoId, setAlgoSessionActive, userAlgos]);

  useEffect(() => {
    if (focusedAlgoLabPresetId) setActiveAlgoTab("lab");
  }, [focusedAlgoLabPresetId]);

  const presetGroups = useMemo(() => {
    const builtin = {
      heading: "Built-in",
      items: [{ value: BUILTIN_SCALPER_PRESET_ID, label: "Order-book scalper (built-in)" }],
    };
    if (userAlgos.length === 0) return [builtin];
    return [
      builtin,
      { heading: "Your algos", items: userAlgos.map((a) => ({ value: a.id, label: a.name })) },
    ];
  }, [userAlgos]);

  const selectedUser = userAlgos.find((a) => a.id === selectedAlgoId);
  const selectedBlueprint = algoBlueprints.find((b) => b.implementation.presetId === selectedAlgoId);
  const canRunBundledScalper =
    selectedAlgoId === BUILTIN_SCALPER_PRESET_ID ||
    selectedUser?.strategyId === BUILTIN_SCALPER_PRESET_ID;
  const selectedIsRunnable = selectedAlgoId === BUILTIN_SCALPER_PRESET_ID || Boolean(selectedBlueprint?.implementation.runnable);
  const selectedConfig = selectedUser?.config ?? scalperUserConfig;
  const selectedPresetName = selectedUser?.name ?? "Order-book scalper";
  const scalperEngineActive =
    algoSessionActive &&
    (tradingMode === "paper" || tradingMode === "real") &&
    canRunBundledScalper;
  const hasMint = Boolean(chartAnalytics.mint);
  const hasOrderBookReady = chartAnalytics.orderBookConn === "open";
  const canPaperStart = selectedIsRunnable && canRunBundledScalper && hasMint && hasOrderBookReady;
  const hasTradingWallet = Boolean(tradingWalletPk);
  const hasPumpKey = Boolean(getEffectivePumpPortalApiKey().trim());
  const canRealStart = canPaperStart && hasTradingWallet && hasPumpKey;

  const presetPickerDisplay = scalperEngineActive
    ? tradingMode === "real"
      ? "Running · real money"
      : "Running · practice"
    : undefined;

  const userAlgoDescription = selectedUser?.description?.trim() ? selectedUser.description : null;

  const sessionStripError =
    tradingMode === "real" && algoSessionActive && chartAnalytics.livePumpPortalLastErr;

  const defaultSessionName = () =>
    `Trading session ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;

  const startNamedSession = (nameInput: string) => {
    if (!canRunBundledScalper || !selectedIsRunnable || !chartAnalytics.mint) return;
    if (chartAnalytics.orderBookConn !== "open") {
      setTradingNotice("Order book stream is not ready. Open the chart/order book feed first.");
      return;
    }
    if (tradingMode === "real" && !getEffectivePumpPortalApiKey().trim()) {
      setTradingNotice(
        appendPumpPortalTradingWalletHint(
          "PumpPortal API key missing — add it in Setup.",
        ),
      );
      return;
    }
    if (tradingMode === "real" && !getPumpPortalTradingWalletPubkey()) {
      setTradingNotice("Trading wallet missing. Add wallet secret in Setup before starting real trading.");
      return;
    }
    const name = nameInput.trim();
    if (!name) return;
    startTradingSessionRecord({
      name,
      mode: tradingMode,
      strategyId: BUILTIN_SCALPER_PRESET_ID,
      presetId: selectedAlgoId ?? BUILTIN_SCALPER_PRESET_ID,
      presetName: selectedPresetName,
      mint: chartAnalytics.mint,
      walletPk: getPumpPortalTradingWalletPubkey(),
      configSnapshot: selectedConfig,
      liveBuySol: scalperLiveBuySol,
      startSnapshot: {
        tapeSampleSize: chartAnalytics.tapeSummary?.sampleSize ?? 0,
        latestMcUsd: chartAnalytics.tapeSummary?.latestMcUsd ?? null,
        orderBookConn: chartAnalytics.orderBookConn,
        orderBookLastTradeAt: chartAnalytics.orderBookLastTradeAt,
      },
    });
    setTradingHalted(false);
    setAlgoSessionActive(true);
    setNamingSessionOpen(false);
    setTradingNotice("Session saved. Trading started.");
  };

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden"
      style={{ background: "var(--color-bg-sideBar)" }}
    >
      <AlgoTabs
        activeTab={activeAlgoTab}
        onTabChange={setActiveAlgoTab}
        algoLabPanel={<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden unt-panel-inner"><TrainingDataPanel /></div>}
        performancePanel={<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden unt-panel-inner"><PerformancePanel /></div>}
      >
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden unt-panel-inner">
        <section className="unt-section-card space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="unt-section-title">Algo trading</h2>
            <Tooltip text="Pick a preset, name the run, then start a paper or real session." side="right">
              <span className="grid size-4 cursor-help place-items-center rounded-full border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-fg-dim)]">?</span>
            </Tooltip>
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

            {chartAnalytics.mint ? (
              <div className="mt-3">
                <StreamHealthBanner
                  mint={chartAnalytics.mint}
                  orderBookConn={chartAnalytics.orderBookConn}
                  orderBookError={chartAnalytics.orderBookError}
                  orderBookLastTradeAt={chartAnalytics.orderBookLastTradeAt}
                />
              </div>
            ) : null}

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

                  liveChainTrades={chartAnalytics.realBotTrades}
                />
              </div>
            ) : selectedAlgoId != null ? (
              <div className="mt-3 space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="unt-section-overline mb-0">{selectedPresetName}</h3>
                  <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)]">
                    {selectedIsRunnable ? "Runnable" : "Draft"}
                  </span>
                </div>
                {userAlgoDescription ? <p className="unt-body-text text-[var(--color-fg-muted)]">{userAlgoDescription}</p> : null}
                {!selectedIsRunnable ? (
                  <p className="unt-help-text text-amber-300/80">
                    This preset is an Algo Lab draft. Build and verify its engine before starting a Trading session.
                  </p>
                ) : null}
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
                <Tooltip text="How much SOL each buy uses in Real mode (real money). Locked while a session is running." side="right">
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
              <Tooltip text="Every run is saved with its name, preset, mint, knobs, tape snapshot, and closed trades." side="top">
                <span className="grid size-4 cursor-help place-items-center rounded-full border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-fg-dim)]">?</span>
              </Tooltip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Paper = practice, no real money. Real = real buys and sells using your wallet and PumpPortal." side="top">
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
              {!algoSessionActive && tradingMode === "real" && (!hasTradingWallet || !hasPumpKey) ? (
                <span className="text-[11px] text-amber-300/85">
                  Real mode needs wallet + PumpPortal key.
                </span>
              ) : null}
              {!algoSessionActive && !hasOrderBookReady ? (
                <span className="text-[11px] text-[var(--color-fg-dim)]">
                  Waiting for order book stream.
                </span>
              ) : null}
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
                    : !selectedIsRunnable
                      ? "This preset is still an Algo Lab draft"
                      : !canRunBundledScalper
                        ? "This preset does not have a runnable trading engine yet"
                      : !chartAnalytics.mint
                        ? "Paste a token CA in the Chart tab first"
                        : tradingMode === "real"
                          ? "Start live trading — uses your PumpPortal wallet"
                          : "Start paper trading — no real money used"
                }
                side="top"
              >
              <button
                type="button"
                className="unt-btn-primary shrink-0 px-4 py-2 text-[13px] font-medium"
                disabled={!algoSessionActive && (tradingMode === "real" ? !canRealStart : !canPaperStart)}
                onClick={() => {
                  if (algoSessionActive) {
                    hardStopTrading();
                    setNamingSessionOpen(false);
                    return;
                  }
                  setSessionNameDraft(defaultSessionName());
                  setNamingSessionOpen(true);
                }}
              >
                {algoSessionActive ? "Stop" : "Start"}
              </button>
              </Tooltip>
              {/* Sell All — emergency exit when real money is deployed */}
              {algoSessionActive &&
                tradingMode === "real" &&
                chartAnalytics.paperScalper?.status === "in_trade" ? (
                <Tooltip text="Immediately sell 100 % of your position on-chain, then stop the session." side="top">
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-rose-500/60 bg-rose-600/20 px-3 py-2 text-[12px] font-semibold text-rose-200 transition-all hover:border-rose-400/70 hover:bg-rose-600/35 active:scale-95"
                    onClick={() => requestManualSell()}
                  >
                    Sell All
                  </button>
                </Tooltip>
              ) : null}
            </div>
            {namingSessionOpen && !algoSessionActive ? (
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.025)] p-3">
                <label className="unt-field-label" htmlFor="trading-session-name">Session name</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="trading-session-name"
                    value={sessionNameDraft}
                    onChange={(e) => setSessionNameDraft(e.target.value)}
                    className="unt-input h-9 min-w-0 flex-1 text-[13px]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => startNamedSession(sessionNameDraft)}
                    disabled={!sessionNameDraft.trim()}
                    className="unt-btn-primary px-3 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setNamingSessionOpen(false)}
                    className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {tradingNotice ? (
              <p className={
                "unt-help-text whitespace-pre-wrap font-medium " +
                (tradingNotice.startsWith("Session saved") ? "text-emerald-400/90" : "text-amber-400/90")
              }>{tradingNotice}</p>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-4">
            <div className="flex items-center gap-2">
              <h3 className="unt-section-overline mb-0">Live bot trades</h3>
              <Tooltip text="Closed round trips from the active session appear here." side="top">
                <span className="grid size-4 cursor-help place-items-center rounded-full border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-fg-dim)]">?</span>
              </Tooltip>
            </div>
            {tradingMode === "real" ? (
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
                <BotTradesBook
                  rows={chartAnalytics.realBotTrades}
                  emptyHint="No on-chain round-trips logged yet. After a sell confirms, we parse buy+sell txs via RPC (Setup wallet secret required)."
                />
              </>
            ) : (
              <BotTradesBook
                rows={chartAnalytics.paperScalper?.botTrades ?? []}
                emptyHint={botTradesBookEmptyHint(chartAnalytics.paperScalper, scalperUserConfig)}
                paperMode
              />
            )}
          </div>
        </section>
      </div>
      </AlgoTabs>
    </div>
  );
}

function SuggestLinesButton() {
  const { refreshSuggestedBounceZones, floorCandlesStatus, chartAnalytics, model } = useApp();
  const [noKeyWarning, setNoKeyWarning] = useState(false);

  const candlesLoading = floorCandlesStatus === "loading";
  const visionLoading = chartAnalytics.visionDetectStatus === "loading";
  const loading = candlesLoading || visionLoading;
  const disabled = floorCandlesStatus === "idle" || candlesLoading;
  const noApiKey = !model.apiKey.trim();

  // Auto-hide the "no key" warning after 3 s
  useEffect(() => {
    if (!noKeyWarning) return;
    const t = window.setTimeout(() => setNoKeyWarning(false), 3000);
    return () => window.clearTimeout(t);
  }, [noKeyWarning]);

  const tooltipText = noKeyWarning
    ? "⚠ Connect your LLM API key in Setup first."
    : candlesLoading
      ? "Fetching candles… bounce lines will appear automatically."
      : visionLoading
        ? "Running vision analysis… AI is reading the chart."
        : disabled
          ? "Paste a mint to load bounce lines automatically."
          : noApiKey
            ? "Connect your LLM API key in Setup to enable AI vision analysis."
            : chartAnalytics.visionDetectError
              ? `Last vision attempt failed: ${chartAnalytics.visionDetectError}`
              : chartAnalytics.visionDetectStatus === "done"
                ? "Re-run: algo detection + AI vision analysis of the chart."
                : "Re-run bounce detection + AI vision analysis of the chart.";

  const label = candlesLoading
    ? "Loading candles…"
    : visionLoading
      ? "AI reading chart…"
      : "Refresh bounce lines";

  const isReady = !disabled && !loading && !noApiKey && !chartAnalytics.visionDetectError;

  const handleClick = () => {
    if (disabled || loading) return;
    if (noApiKey) {
      setNoKeyWarning(true);
      return;
    }
    refreshSuggestedBounceZones();
  };

  return (
    <Tooltip text={tooltipText} side="left">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading}
        style={isReady ? {
          background: "linear-gradient(135deg, #0c4a6e 0%, #0369a1 45%, #0ea5e9 100%)",
          boxShadow: "0 0 10px rgba(14,165,233,0.45), 0 0 22px rgba(3,105,161,0.3)",
          border: "1px solid rgba(125,211,252,0.35)",
          animation: "untBetaPulse 2.4s ease-in-out infinite",
        } : noApiKey && !disabled ? {
          background: "rgba(220,38,38,0.08)",
          border: "1px solid rgba(248,113,113,0.25)",
        } : undefined}
        className={
          "relative flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-bold tracking-wide transition-all " +
          (disabled || loading
            ? "cursor-not-allowed border-purple-400/15 bg-purple-500/5 text-purple-100/35"
            : noKeyWarning
              ? "border-rose-400/60 bg-rose-500/15 text-rose-200"
              : noApiKey
                ? "cursor-pointer border-rose-500/25 text-rose-300/70 hover:border-rose-400/40 hover:text-rose-200/90"
                : chartAnalytics.visionDetectError
                  ? "border-red-400/35 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                  : "text-white hover:brightness-110")
        }
      >
        {/* BETA badge */}
        {isReady && (
          <span
            style={{ fontSize: "7.5px", letterSpacing: "0.1em", opacity: 0.9 }}
            className="rounded bg-white/15 px-1 py-px font-black uppercase text-white"
          >
            BETA
          </span>
        )}
        {noKeyWarning
          ? "⚠"
          : loading
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-purple-300/60 border-t-purple-200" />
            : chartAnalytics.visionDetectError
              ? "⚠"
              : null}
        {label}
      </button>
    </Tooltip>
  );
}

function BounceZonesEditor({ mint }: { mint: string }) {
  const { bounceZones, toggleBounceZone, updateBounceZonePrice, addBounceZone, removeBounceZone } = useApp();
  const [newPrice, setNewPrice] = useState("");

  const zones = bounceZones.filter((z) => z.mint === mint).sort((a, b) => b.price - a.price);

  return (
    <div className="space-y-2">
      {zones.length === 0 && (
        <p className="text-[10px] leading-snug text-[var(--color-fg-dim)]">
          Bounce lines load automatically once 3 000 candles are fetched. Add your own levels below.
        </p>
      )}

      {zones.map((z) => (
        <ZoneRow key={z.id} zone={z}
          onToggle={() => toggleBounceZone(z.id)}
          onPriceChange={(p) => updateBounceZonePrice(z.id, p)}
          onRemove={() => removeBounceZone(z.id)}
        />
      ))}

      {/* Add manual zone */}
      <div className="flex gap-1.5">
        <input
          type="number"
          placeholder="Add price level…"
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
          className="unt-input h-7 min-w-0 flex-1 font-mono text-[11px] tabular-nums"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const p = Number(newPrice);
              if (p > 0) { addBounceZone(mint, p); setNewPrice(""); }
            }
          }}
        />
        <button
          type="button"
          className="rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-fg-dim)] hover:border-sky-400/40 hover:text-sky-300"
          onClick={() => {
            const p = Number(newPrice);
            if (p > 0) { addBounceZone(mint, p); setNewPrice(""); }
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ZoneRow({ zone, onToggle, onPriceChange, onRemove }: {
  zone: UserBounceZone;
  onToggle: () => void;
  onPriceChange: (p: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(zone.price.toFixed(2)));

  const commit = () => {
    const p = Number(draft);
    if (p > 0) onPriceChange(p);
    else setDraft(zone.price.toFixed(2));
    setEditing(false);
  };

  return (
    <div className={
      "flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors " +
      (zone.enabled
        ? "border-sky-400/25 bg-sky-500/5"
        : "border-[var(--color-border-subtle)] opacity-50")
    }>
      {/* Enable toggle */}
      <button type="button" onClick={onToggle} className="shrink-0 text-[10px]" title={zone.enabled ? "Disable zone" : "Enable zone"}>
        <span className={zone.enabled ? "text-sky-400" : "text-[var(--color-fg-dim)]"}>
          {zone.enabled ? "●" : "○"}
        </span>
      </button>

      {/* Price */}
      {editing ? (
        <input
          autoFocus
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(zone.price.toFixed(2)); setEditing(false); } }}
          className="unt-input h-5 w-24 font-mono text-[11px] tabular-nums"
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 text-left font-mono text-[11px] tabular-nums text-[var(--color-fg)] hover:text-sky-300"
          onClick={() => { setDraft(zone.price.toFixed(2)); setEditing(true); }}
          title="Click to edit price"
        >
          ${zone.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
        </button>
      )}

      {/* Meta — show which timeframes contributed, or "manual" */}
      <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">
        {(() => {
          const src = (zone as { sources?: string }).sources;
          if (!src) return zone.touches > 0 ? `×${zone.touches}` : "manual";
          if (src === "swing") return "Swing low";
          if (src.startsWith("swing+")) return `Swing · ${src.slice("swing+".length)}`;
          if (src.startsWith("vision·")) return `👁 ${src.slice("vision·".length)}`;
          return src;
        })()}
      </span>

      {/* Remove */}
      <button type="button" onClick={onRemove} className="shrink-0 text-[10px] text-[var(--color-fg-dim)] hover:text-red-400" title="Remove zone">
        ✕
      </button>
    </div>
  );
}

function ScalperPaperPanel({
  snapshot,
  mint,
  orderBookConn,
  paperSessionActive,
  tradingMode,
  liveChainTrades,
}: {
  snapshot: ScalperPaperSnapshot | null;
  mint: string | null;
  orderBookConn: "idle" | "connecting" | "open" | "closed" | "error";
  paperSessionActive: boolean;
  tradingMode: TradingMode;
  liveChainTrades: BotTradeRow[];
}) {
  const { scalperUserConfig } = useApp();

  const wrap = (belowRules: React.ReactNode) => (
    <div className="space-y-2 text-[12px]">
      <div className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-editor)]">
        <div className="border-b border-[var(--color-border-subtle)] px-3 py-2">
          <span className="text-[11px] font-semibold tracking-wide text-[var(--color-fg-muted)]">
            Strategy blueprint (read-only in Trading)
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2.5 text-[11px]">
          <div>
            <span className="text-[var(--color-fg-dim)]">Entry dip:</span>{" "}
            <span className="font-mono text-[var(--color-fg)]">{scalperUserConfig.dipMinPct}%</span>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">Entry min buy:</span>{" "}
            <span className="font-mono text-[var(--color-fg)]">{scalperUserConfig.catalystMinSol} SOL</span>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">Exit take profit:</span>{" "}
            <span className="font-mono text-[var(--color-fg)]">{scalperUserConfig.takeProfitPct}%</span>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">Exit stop sell:</span>{" "}
            <span className="font-mono text-[var(--color-fg)]">{scalperUserConfig.minOrderBookSellSolForStop} SOL</span>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">Re-entry cooldown:</span>{" "}
            <span className="font-mono text-[var(--color-fg)]">{Math.round(scalperUserConfig.reentryCooldownMs / 1000)}s</span>
          </div>
          {tradingMode === "real" ? (
            <>
              <div>
                <span className="text-[var(--color-fg-dim)]">Slippage:</span>{" "}
                <span className="font-mono text-[var(--color-fg)]">{scalperUserConfig.realSlippagePct}%</span>
              </div>
              <div>
                <span className="text-[var(--color-fg-dim)]">Priority fee:</span>{" "}
                <span className="font-mono text-[var(--color-fg)]">{scalperUserConfig.realPriorityFeeSol} SOL</span>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Bounce zones card ── */}
      {mint ? (
        <div className="overflow-hidden rounded-lg border border-[color-mix(in_srgb,#38bdf8_18%,var(--color-border-subtle))] bg-[var(--color-bg-editor)]">
          <div
            className="flex items-center gap-2 border-b px-3 py-2"
            style={{
              borderColor: "color-mix(in srgb, #38bdf8 15%, var(--color-border-subtle))",
              background: "color-mix(in srgb, #38bdf8 6%, transparent)",
            }}
          >
            <div className="h-3 w-0.5 shrink-0 rounded-full bg-sky-400/70" />
            <span className="text-[11px] font-semibold tracking-wide text-sky-200/90">Vision bounce zones (default)</span>
            <div className="ml-auto">
              <SuggestLinesButton />
            </div>
          </div>
          <div className="px-3 py-2.5">
          <Tooltip
            text="Refresh bounce lines sends one chart image to your LLM per click — costs more than plain chat. Check your provider usage dashboard."
            side="bottom"
          >
            <div
              role="note"
              className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-2 py-1.5 text-[10px] font-medium leading-snug text-amber-100/95"
            >
              <span className="shrink-0 select-none" aria-hidden>
                ⚠
              </span>
              <span>Check API credit spend - still optimizing</span>
            </div>
          </Tooltip>
          <BounceZonesEditor mint={mint} />
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[color-mix(in_srgb,#38bdf8_14%,var(--color-border-subtle))] bg-[var(--color-bg-editor)]">
          <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,#38bdf8_15%,var(--color-border-subtle))] bg-[color-mix(in_srgb,#38bdf8_6%,transparent)] px-3 py-2">
            <div className="h-3 w-0.5 shrink-0 rounded-full bg-sky-400/70" />
            <span className="text-[11px] font-semibold tracking-wide text-sky-200/90">Vision bounce zones (default)</span>
          </div>
          <div className="px-3 py-2.5 text-[10.5px] text-[var(--color-fg-dim)]">
            Vision lines are enabled by default for every algo. Load a mint in Chart to populate and edit zones.
          </div>
        </div>
      )}

      {belowRules}
    </div>
  );

  if (!paperSessionActive) {
    return wrap(
      <p className="unt-help-text">
        Tap <strong className="font-semibold text-[var(--color-fg-muted)]">Start</strong> below. Paste a coin on the Chart tab so we can see live trades — numbers show up here when it&apos;s working.
      </p>,
    );
  }
  if (!mint) {
    return wrap(
      <p className="unt-help-text">
        Put this same coin on the Chart tab first — we need live trades to run.
      </p>,
    );
  }
  if (orderBookConn !== "open") {
    const plain =
      orderBookConn === "connecting"
        ? "Still connecting to live trades…"
        : orderBookConn === "error"
          ? "Something broke connecting to live trades. Refresh or try again."
          : "Live trades are turned off. Open the Chart tab with your coin.";
    return wrap(<p className="unt-help-text">{plain}</p>);
  }
  if (!snapshot) {
    return wrap(<p className="unt-help-text">Hang tight — connecting to live trades…</p>);
  }

  const st =
    snapshot.status === "watching"
      ? "Watching"
      : snapshot.status === "nearing"
        ? "Nearing bounce region — arming trade"
        : snapshot.status === "dip"
          ? "Dipped — not armed yet"
          : snapshot.status === "arming"
            ? `Armed — next ${scalperUserConfig.catalystMinSol}+ SOL buy fires`
            : "In a trade";

  const chainLegs =
    tradingMode === "real" ? liveChainTrades.filter(isBotTradeChain) : [];
  const chainClosed = chainLegs.length;
  const chainWins = chainLegs.filter((t) => t.netSol > 0).length;
  const chainWinRate = chainClosed > 0 ? (chainWins / chainClosed) * 100 : null;
  const chainNetSum = chainLegs.reduce((s, t) => s + t.netSol, 0);

  const tapePaperEstLegs: (BotTradeRowTape & { paperSolEstimate: NonNullable<BotTradeRowTape["paperSolEstimate"]> })[] =
    tradingMode === "paper"
      ? snapshot.botTrades.filter(
          (t): t is BotTradeRowTape & { paperSolEstimate: NonNullable<BotTradeRowTape["paperSolEstimate"]> } =>
            t.kind === "tape" && t.paperSolEstimate != null,
        )
      : [];
  const paperEstNetSum = tapePaperEstLegs.reduce((s, t) => s + t.paperSolEstimate.netSol, 0);

  return wrap(
    <>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Status</span>
        <span
          className={
            snapshot.status === "nearing"
              ? "text-amber-400 font-medium"
              : snapshot.status === "arming"
                ? "text-emerald-400 font-medium"
                : snapshot.status === "in_trade"
                  ? "text-emerald-300 font-medium"
                  : "text-[var(--color-fg)]"
          }
        >
          {st}
        </span>
      </div>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Win rate</span>
        <span className="text-[var(--color-fg)]">
          {tradingMode === "real"
            ? chainWinRate != null
              ? chainWinRate.toFixed(1) + "%"
              : "—"
            : snapshot.winRate != null
              ? snapshot.winRate.toFixed(1) + "%"
              : "—"}
        </span>
      </div>
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span title={tradingMode === "real" ? "SOL added or removed from your wallet after each finished trade." : "Adds up the chart move % on each practice trade."}>
          {tradingMode === "real" ? "Total SOL" : "Practice total %"}
        </span>
        <span
          className={
            tradingMode === "real"
              ? chainClosed > 0
                ? chainNetSum >= 0
                  ? "text-emerald-300"
                  : "text-red-400"
                : "text-[var(--color-fg)]"
              : snapshot.totalPnlPct >= 0
                ? "text-emerald-300"
                : "text-red-400"
          }
        >
          {tradingMode === "real"
            ? chainClosed > 0
              ? (chainNetSum >= 0 ? "+" : "") + formatSol(chainNetSum)
              : "—"
            : (snapshot.totalPnlPct >= 0 ? "+" : "") + snapshot.totalPnlPct.toFixed(2) + "%"}
        </span>
      </div>
      {tradingMode === "paper" && snapshot.closedTrades > 0 ? (
        <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
          <span title="Rough SOL profit on practice trades when we have enough price data (not perfect).">
            Est. practice SOL
          </span>
          <span
            className={
              tapePaperEstLegs.length > 0
                ? paperEstNetSum >= 0
                  ? "text-cyan-300/95"
                  : "text-orange-300/95"
                : "text-[var(--color-fg)]"
            }
          >
            {tapePaperEstLegs.length > 0
              ? (paperEstNetSum >= 0 ? "+" : "") + formatSol(paperEstNetSum)
              : "—"}
          </span>
        </div>
      ) : null}
      <div className="flex justify-between gap-2 text-[var(--color-fg-muted)]">
        <span>Closed trades</span>
        <span className="text-[var(--color-fg)]">
          {tradingMode === "real" ? chainClosed : snapshot.closedTrades}
        </span>
      </div>
      <div className="border-t border-[var(--color-border-subtle)] pt-2">
        <div className="unt-section-overline">Current trade</div>
      </div>
      {snapshot.currentTrade ? (
        <div className="space-y-1 text-[11px] leading-snug text-[var(--color-fg-muted)]">
          <div>Bought near {formatUsdCompact(snapshot.currentTrade.entryMcUsd)}</div>
          <div>Big buy that triggered us: {snapshot.currentTrade.catalystSol.toFixed(2)} SOL</div>
          {snapshot.currentTrade.lastMcUsd != null ? (
            <div>Chart now {formatUsdCompact(snapshot.currentTrade.lastMcUsd)}</div>
          ) : null}
          {snapshot.currentTrade.unrealizedPct != null ? (
            <div>
              Unrealized profit{" "}
              <span
                className={
                  snapshot.currentTrade.unrealizedPct >= 0 ? "text-emerald-300" : "text-red-400"
                }
              >
                {(snapshot.currentTrade.unrealizedPct >= 0 ? "+" : "") +
                  snapshot.currentTrade.unrealizedPct.toFixed(2) +
                  "%"}
              </span>
              {tradingMode === "real" ? (
                <span className="text-[var(--color-fg-dim)]"> (same as chart)</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--color-fg-dim)]">
          {snapshot.status === "nearing" ? (
            <span className="text-amber-400 font-medium">⚠️ Nearing bounce region — arming trade</span>
          ) : snapshot.status === "arming" ? (
            <span className="text-emerald-400 font-medium">🟢 Armed — waiting for catalyst buy</span>
          ) : snapshot.status === "dip" ? (
            <span className="text-sky-400">Dipped — waiting for zone alignment</span>
          ) : (
            <span>Flat</span>
          )}
        </div>
      )}
    </>,
  );
}

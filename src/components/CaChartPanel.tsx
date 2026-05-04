import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineStyle,
  TickMarkType,
} from "lightweight-charts";
import type {
  CandlestickData,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

type BouncePriceLineHandle = ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>;
import { PumpOrderBook } from "@/components/PumpOrderBook";
import { TokenInfoBar } from "@/components/TokenInfoBar";
import { useApp, type ChartCandleBarSummary, type ChartTapeSummary, type UserBounceZone } from "@/context/AppContext";
import { usePumpPortalTrades } from "@/hooks/usePumpPortalTrades";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import {
  CHART_INTERVALS,
  PUMP_CANDLES_MAX_LIMIT,
  chartIntervalBucketSec,
  fetchPumpCandles,
  fetchPumpCandlesPaged,
  getCachedCandles,
  setCachedCandles,
  mergeBaseCandles,
  mergeLiveMcUsdIntoCandles,
  pumpPortalMcScaleFactor,
  type ChartInterval,
} from "@/lib/pumpCandles";
import { formatUsdCompact } from "@/lib/formatUsd";
import {
  CHART_TIMEZONE_SELECT_OPTIONS,
  detectBrowserTimeZone,
  effectiveChartTimeZone,
  formatChartCrosshairTime,
  formatChartTickMark,
  formatTimezoneHudLabel,
  loadChartTimezoneChoice,
  saveChartTimezoneChoice,
  type ChartTimezoneChoice,
} from "@/lib/chartTimezone";
import { reduceScalperPaper, type BotTradeRowChain } from "@/lib/scalperPaperEngine";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import {
  appendPumpPortalTradingWalletHint,
  getEffectivePumpPortalApiKey,
  getPumpPortalTradingWalletPubkey,
} from "@/lib/pumpPortalConfig";
import { fetchWalletSolDeltaSol } from "@/lib/solanaTxSolDelta";
import { detectBounceZones, MIN_BOOTSTRAP_CANDLES } from "@/lib/chartBounceZones";
import {
  inferPumpPortalTradePool,
  postPumpPortalLightningTradeWithFallback,
  confirmLightningTx,
} from "@/lib/pumpPortalLightningTrade";
import {
  detectBounceZonesVision,
} from "@/lib/visionBounceDetect";

/** Dark trading terminal palette (high-contrast teal up / coral down on charcoal). */
const BG = "#0b0e11";
const GRID = "#1c2128";
const FG = "#9aa4b2";
const UP = "#2EA8FF";
const DOWN = "#ff6a6a";
const CROSSHAIR = "rgba(154, 164, 178, 0.4)";
const CROSSHAIR_LABEL_BG = "#151a21";

/** Bottom-right clock + GMT offset; click opens compact zone list (TradingView-style). */
function ChartTimezoneHud({
  chartTzChoice,
  onPickChoice,
}: {
  chartTzChoice: ChartTimezoneChoice;
  onPickChoice: (c: ChartTimezoneChoice) => void;
}) {
  const effectiveTz = useMemo(() => effectiveChartTimeZone(chartTzChoice), [chartTzChoice]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
  const badgeLabel = useMemo(
    () => formatTimezoneHudLabel(effectiveTz, locale, new Date()),
    [effectiveTz, locale, tick],
  );

  function pick(next: ChartTimezoneChoice) {
    saveChartTimezoneChoice(next);
    onPickChoice(next);
    setOpen(false);
  }

  const unknownSaved =
    chartTzChoice !== "auto" && !CHART_TIMEZONE_SELECT_OPTIONS.some((o) => o.value === chartTzChoice);

  return (
    <div ref={wrapRef} className="relative pointer-events-none flex flex-col items-end gap-1">
      <button
        type="button"
        title="Chart time zone — click to change"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto rounded border border-white/[0.11] bg-[#0b0e11]/90 px-2 py-0.5 font-mono text-[11px] tabular-nums tracking-tight text-[var(--color-fg-muted)] shadow-md backdrop-blur-[6px] transition-colors hover:border-white/20 hover:text-[var(--color-fg)]"
      >
        {badgeLabel}
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Time zones"
          className="pointer-events-auto absolute bottom-full right-0 z-20 mb-1 max-h-52 min-w-[11rem] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-editor)] py-1 text-[11px] shadow-xl"
        >
          <li className="list-none">
            <button
              type="button"
              role="option"
              aria-selected={chartTzChoice === "auto"}
              className={
                "flex w-full px-2.5 py-1.5 text-left font-mono hover:bg-[rgba(255,255,255,0.06)] " +
                (chartTzChoice === "auto" ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)]")
              }
              onClick={() => pick("auto")}
            >
              Auto · {detectBrowserTimeZone()}
            </button>
          </li>
          <li className="list-none px-2 py-1" aria-hidden>
            <div className="h-px bg-[var(--color-border-subtle)]" />
          </li>
          {CHART_TIMEZONE_SELECT_OPTIONS.map((o) => (
            <li key={o.value} className="list-none">
              <button
                type="button"
                role="option"
                aria-selected={chartTzChoice === o.value}
                className={
                  "flex w-full px-2.5 py-1.5 text-left hover:bg-[rgba(255,255,255,0.06)] " +
                  (chartTzChoice === o.value ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)]")
                }
                onClick={() => pick(o.value)}
              >
                {o.label}
              </button>
            </li>
          ))}
          {unknownSaved ? (
            <li className="list-none px-2.5 py-1 font-mono text-[var(--color-fg-dim)]" title="Saved custom zone">
              {chartTzChoice}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Rough Solana address shape (base58, typical encode length). */
const LIKELY_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function looksLikeSolMint(s: string): boolean {
  return LIKELY_MINT_RE.test(s);
}

function normalizeMint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const noProto = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const parts = noProto.split(/[\s/?#&]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p && looksLikeSolMint(p)) return p;
  }
  const head = parts[0] ?? trimmed;
  return head.replace(/^[a-z]+:\/\//i, "").split(/[\s/?#]/)[0] ?? "";
}

function snapMarkerToBucket(timeSec: number, bucketSec: number): number {
  if (bucketSec <= 1) return timeSec;
  return Math.floor(timeSec / bucketSec) * bucketSec;
}

/** Map paper trade time to an existing candle `time` so markers attach to a bar. */
function alignPaperMarkerToBars(
  timeSec: number,
  bucketSec: number,
  rows: CandlestickData<UTCTimestamp>[],
): number | null {
  if (rows.length === 0) return null;
  const snap = snapMarkerToBucket(timeSec, bucketSec);
  const times = rows.map((r) => r.time as number);
  if (times.includes(snap)) return snap;
  let best: number | null = null;
  let bestD = Infinity;
  for (const t of times) {
    const d = Math.abs(t - snap);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function CaChartPanel() {
  const {
    caMintInput,
    setCaMintInput,
    selectedAlgoId,
    setChartAnalytics,
    algoSessionActive,
    setAlgoSessionActive,
    tradingMode,
    tradingHalted,
    setTradingHalted,
    hardStopTrading,
    scalperLiveBuySol,
    appendPersistedTrades,
    bounceZones,
    setDetectedZones,
    updateBounceZonePrice,
    scalperUserConfig,
    bounceSuggestionTick,
    setFloorCandlesStatus,
    model,
    manualSellRequested,
    clearManualSellRequest,
  } = useApp();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  /** Zone id → chart price line (updated during drag without React thrash). */
  const bouncePriceLineHandlesRef = useRef<Map<string, BouncePriceLineHandle>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesMarkersPluginRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);
  const fetchGenRef = useRef(0);
  const didFitRef = useRef(false);
  /**
   * Ref-stable snapshot of baseRows used to detect full-refresh vs live-tick in the chart
   * data effect. When only live rows change we use `series.update()` which preserves price
   * lines; when baseRows change we need `setData()` and must re-draw bounce lines after.
   */
  const prevBaseRowsRef = useRef<typeof baseRows>([]);

  const [debouncedMint, setDebouncedMint] = useState("");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("5s");
  const [chartTzChoice, setChartTzChoice] = useState<ChartTimezoneChoice>(() => loadChartTimezoneChoice());
  const [scalperCutoffMs, setScalperCutoffMs] = useState<number | null>(null);
  const [livePumpPortalSig, setLivePumpPortalSig] = useState<string | null>(null);
  const [livePumpPortalErr, setLivePumpPortalErr] = useState<string | null>(null);
  /** Confirmed Lightning round-trips with RPC-parsed wallet SOL (real mode only). */
  const [liveChainTrades, setLiveChainTrades] = useState<BotTradeRowChain[]>([]);
  const [chartSessionNotice, setChartSessionNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!chartSessionNotice) return;
    const tick = window.setTimeout(() => setChartSessionNotice(null), 6200);
    return () => window.clearTimeout(tick);
  }, [chartSessionNotice]);

  const effectiveTz = useMemo(() => effectiveChartTimeZone(chartTzChoice), [chartTzChoice]);

  const streamMint = useMemo(() => {
    const m = normalizeMint(caMintInput);
    return looksLikeSolMint(m) ? m : null;
  }, [caMintInput]);

  const [mintLoaded, setMintLoaded] = useState<string | null>(null);
  const [baseRows, setBaseRows] = useState<CandlestickData<UTCTimestamp>[]>([]);
  /**
   * 3 × 1000 5m candles prefetched when a mint loads — used by "Suggest lines" on demand.
   * Always 5m so the detector sees ~10 days of structural history regardless of chart interval.
   */
  const [floorDetectionRows, setFloorDetectionRows] = useState<CandlestickData<UTCTimestamp>[]>([]);
  const floorFetchGenRef = useRef(0);
  const [yMcCap, setYMcCap] = useState(true);
  /** SPL minted supply (`getTokenSupply` uiAmount) when RPC succeeded. */
  const [tokenUiSupply, setTokenUiSupply] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    rows: liveRows,
    state: liveState,
    error: liveErr,
    lastTradeAt: liveLastTradeAt,
  } = usePumpPortalTrades(streamMint, 200);

  const bucketSec = chartIntervalBucketSec(chartInterval);

  /** PumpPortal MC often matches price × 1e9; multiply by minted/1e9 to match on-chain MC. */
  const portalMcFactor = useMemo(
    () => (yMcCap ? pumpPortalMcScaleFactor(tokenUiSupply) : 1),
    [yMcCap, tokenUiSupply],
  );

  const liveRowsForMc = useMemo(() => {
    if (portalMcFactor === 1) return liveRows;
    return liveRows.map((r) =>
      r.mcUsd == null ? r : { ...r, mcUsd: r.mcUsd * portalMcFactor },
    );
  }, [liveRows, portalMcFactor]);

  /** Lightning pool hint from tape (bonding snapshots vs graduated prints). */
  const lightningPoolPreference = useMemo(() => {
    const cfg = SCALPER_PAPER_CONFIG.realPool as string;
    if (cfg !== "auto") return cfg;
    const h = inferPumpPortalTradePool(liveRowsForMc);
    return h === "auto" ? "auto" : h;
  }, [liveRowsForMc]);

  const chartRows = useMemo(
    () => mergeLiveMcUsdIntoCandles(baseRows, liveRowsForMc, bucketSec),
    [baseRows, liveRowsForMc, bucketSec],
  );

  const lastCandleSummary = useMemo((): ChartCandleBarSummary | null => {
    if (chartRows.length === 0) return null;
    const last = chartRows[chartRows.length - 1]!;
    return {
      interval: chartInterval,
      timeUnix: last.time as number,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      yAxisIsMarketCapUsd: yMcCap,
    };
  }, [chartRows, chartInterval, yMcCap]);

  const tapeSummary = useMemo((): ChartTapeSummary | null => {
    const active = mintLoaded ?? streamMint;
    if (!active) return null;
    if (liveRowsForMc.length === 0) {
      return {
        sampleSize: 0,
        buyCount: 0,
        sellCount: 0,
        solVolume: 0,
        latestMcUsd: null,
        recentPrints: [],
      };
    }
    const sample = liveRowsForMc;
    let buyCount = 0;
    let sellCount = 0;
    let solVolume = 0;
    for (const r of sample) {
      if (r.buy) buyCount++;
      else sellCount++;
      solVolume += r.sol;
    }
    let latestMcUsd: number | null = sample[0]?.mcUsd ?? null;
    if (latestMcUsd == null) {
      for (const r of sample) {
        if (r.mcUsd != null) {
          latestMcUsd = r.mcUsd;
          break;
        }
      }
    }
    const recentPrints = sample.slice(0, 15).map((r) => ({
      ts: r.ts,
      buy: r.buy,
      sol: r.sol,
      mcUsd: r.mcUsd,
    }));
    return {
      sampleSize: sample.length,
      buyCount,
      sellCount,
      solVolume,
      latestMcUsd,
      recentPrints,
    };
  }, [mintLoaded, streamMint, liveRowsForMc]);

  const scalperEngineRunning =
    algoSessionActive &&
    selectedAlgoId === BUILTIN_SCALPER_PRESET_ID &&
    (tradingMode === "paper" || tradingMode === "real");

  const prevLiveOpenRef = useRef<boolean | undefined>(undefined);
  const lastLiveTxAtRef = useRef(0);
  const pendingLiveBuySigRef = useRef<string | null>(null);
  /** Venue used for the confirmed Lightning buy — sells reuse it so post-migration tokens exit on AMM. */
  const lastBuyVenueRef = useRef<{ mint: string; pool: string } | null>(null);
  /**
   * True only after a real Lightning buy is confirmed on-chain.
   * Guards sells so we never attempt to sell tokens we never actually received
   * (e.g. when the buy returned 400 but prevLiveOpenRef already flipped to true).
   */
  const realPositionOpenRef = useRef(false);

  useEffect(() => {
    const running =
      algoSessionActive &&
      selectedAlgoId === BUILTIN_SCALPER_PRESET_ID &&
      !!mintLoaded &&
      (tradingMode === "paper" || tradingMode === "real");
    if (!running) {
      setScalperCutoffMs(null);
      return;
    }
    setScalperCutoffMs(Date.now());
    if (tradingMode === "real") {
      setLivePumpPortalSig(null);
      setLivePumpPortalErr(null);
      // Reset pending buy ref so a stale buy sig from the previous session
      // can't be paired with a sell from a new session.
      pendingLiveBuySigRef.current = null;
      lastBuyVenueRef.current = null;
      realPositionOpenRef.current = false;
    }
  }, [algoSessionActive, selectedAlgoId, mintLoaded, tradingMode]);

  useEffect(() => {
    if (tradingMode !== "real") {
      setLivePumpPortalSig(null);
      setLivePumpPortalErr(null);
      pendingLiveBuySigRef.current = null;
      lastBuyVenueRef.current = null;
      realPositionOpenRef.current = false;
    }
  }, [tradingMode]);

  useEffect(() => {
    if (tradingMode !== "real") return;
    pendingLiveBuySigRef.current = null;
    lastBuyVenueRef.current = null;
    realPositionOpenRef.current = false;
  }, [mintLoaded, tradingMode]);

  // ── Manual "Sell All" — fires an immediate 100 % sell regardless of engine state ──
  useEffect(() => {
    if (!manualSellRequested) return;
    if (tradingMode !== "real" || !mintLoaded || !realPositionOpenRef.current) {
      clearManualSellRequest();
      hardStopTrading();
      return;
    }

    clearManualSellRequest();
    realPositionOpenRef.current = false;

    const apiKey = getEffectivePumpPortalApiKey().trim();
    if (!apiKey) {
      setLivePumpPortalErr(appendPumpPortalTradingWalletHint("PumpPortal API key missing — add it in Setup."));
      hardStopTrading();
      return;
    }

    const pool =
      lastBuyVenueRef.current?.mint === mintLoaded && lastBuyVenueRef.current.pool
        ? lastBuyVenueRef.current.pool
        : lightningPoolPreference;

    const buySig = pendingLiveBuySigRef.current;
    pendingLiveBuySigRef.current = null;
    lastBuyVenueRef.current = null;

    void (async () => {
      const res = await postPumpPortalLightningTradeWithFallback(apiKey, {
        action: "sell",
        mint: mintLoaded,
        amount: "100%",
        denominatedInSol: "false",
        slippage: scalperUserConfig.realSlippagePct,
        priorityFee: scalperUserConfig.realPriorityFeeSol,
        pool,
      });

      if (!res.ok) {
        const tried = res.attempts.length > 1 ? ` — venues tried: ${res.attempts.join(" → ")}` : "";
        setLivePumpPortalErr(appendPumpPortalTradingWalletHint(`Manual sell failed: ${res.message}${tried}`));
        hardStopTrading();
        return;
      }

      setLivePumpPortalSig(`MANUAL SELL confirming… ${res.signature}`);
      const { confirmed } = await confirmLightningTx(res.signature);
      if (!confirmed) {
        setLivePumpPortalErr(appendPumpPortalTradingWalletHint("Manual sell did not confirm — check Solscan."));
        hardStopTrading();
        return;
      }

      setLivePumpPortalSig(res.signature);

      const walletPk = getPumpPortalTradingWalletPubkey();
      if (buySig && walletPk) {
        const buyDelta = await fetchWalletSolDeltaSol(buySig, walletPk);
        const sellDelta = await fetchWalletSolDeltaSol(res.signature, walletPk);
        if (buyDelta != null && sellDelta != null) {
          const solSpent = Math.max(0, -buyDelta);
          const solReceived = Math.max(0, sellDelta);
          const netSol = buyDelta + sellDelta;
          const roiPct = solSpent > 0 ? (netSol / solSpent) * 100 : 0;
          const chainTrade: BotTradeRowChain = {
            kind: "chain",
            id: `chain-manual-${res.signature}`,
            closedAtTs: Date.now(),
            exitReason: "order_book_sell",
            buySignature: buySig,
            sellSignature: res.signature,
            solSpent,
            solReceived,
            netSol,
            roiPct,
          };
          setLiveChainTrades((prev) => [...prev, chainTrade]);
          appendPersistedTrades([{ ...chainTrade, walletPk, mint: mintLoaded }]);
        }
      }

      hardStopTrading();
    })();
  }, [
    manualSellRequested,
    clearManualSellRequest,
    tradingMode,
    mintLoaded,
    hardStopTrading,
    lightningPoolPreference,
    scalperUserConfig.realSlippagePct,
    scalperUserConfig.realPriorityFeeSol,
    appendPersistedTrades,
  ]);

  const mintZones = useMemo(
    () => (mintLoaded ? bounceZones.filter((z) => z.mint === mintLoaded) : []),
    [bounceZones, mintLoaded],
  );
  /**
   * `undefined` — no bounce rows for this mint → scalper uses dip+catalyst only.
   * `[]` — rows exist but all disabled → proximity filter never passes → no buys.
   * `[prices]` — MC must be within ±10% of an enabled zone to arm.
   */
  const activeBounceZonePricesForScalper = useMemo(() => {
    if (!mintLoaded || mintZones.length === 0) return undefined;
    return mintZones.filter((z) => z.enabled).map((z) => z.price);
  }, [mintLoaded, mintZones]);

  const paperScalper = useMemo(() => {
    if (!scalperEngineRunning || !mintLoaded || scalperCutoffMs == null) return null;
    return reduceScalperPaper(liveRowsForMc, {
      minTradeTsMs: scalperCutoffMs,
      paperBuySol: tradingMode === "paper" ? scalperLiveBuySol : undefined,
      activeBounceZonePrices: activeBounceZonePricesForScalper,
      scalperConfig: scalperUserConfig,
    });
  }, [
    scalperEngineRunning,
    mintLoaded,
    liveRowsForMc,
    scalperCutoffMs,
    tradingMode,
    scalperLiveBuySol,
    activeBounceZonePricesForScalper,
    scalperUserConfig,
  ]);

  const lastPersistedPaperCountRef = useRef(0);

  // Drag refs — kept stable so event listeners don't need re-adding on every render
  const draggingZoneIdRef = useRef<string | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const pendingDragPriceRef = useRef<number | null>(null);
  const bounceZonesRef = useRef(bounceZones);
  const mintLoadedRef = useRef(mintLoaded);
  const updateBounceZonePriceRef = useRef(updateBounceZonePrice);
  useEffect(() => { bounceZonesRef.current = bounceZones; }, [bounceZones]);
  useEffect(() => { mintLoadedRef.current = mintLoaded; }, [mintLoaded]);
  useEffect(() => { updateBounceZonePriceRef.current = updateBounceZonePrice; }, [updateBounceZonePrice]);

  /** Live last-close price — kept current via ref so drag/add callbacks always have it. */
  const livePriceRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastCandleSummary) livePriceRef.current = lastCandleSummary.close;
  }, [lastCandleSummary]);

  // ── Lazy historical load (pan-left → fetch older chunks) ──────────────────
  /** Oldest bar timestamp (seconds) in baseRows — cursor for the next older-chunk fetch. */
  const oldestLoadedTsRef = useRef<number | null>(null);
  /** Guard: true while an older-history chunk request is in-flight. */
  const isFetchingOlderRef = useRef(false);
  /** True once a chunk returns fewer bars than the limit — we've reached token genesis. */
  const hasReachedGenesisRef = useRef(false);
  /** Ref mirror of chartInterval for use inside the timeScale subscription closure. */
  const chartIntervalRef = useRef(chartInterval);
  useEffect(() => { chartIntervalRef.current = chartInterval; }, [chartInterval]);

  // Update oldest-ts cursor whenever baseRows grows (initial load or chunk prepend).
  useEffect(() => {
    if (baseRows.length > 0) {
      oldestLoadedTsRef.current = baseRows[0]!.time as number;
    }
  }, [baseRows]);

  /**
   * Re-draw all bounce zone price lines after `series.setData()` wipes them.
   * Reads from refs so it can be called inside any effect without adding deps.
   */
  /** Merge zones whose prices almost coincide — prevents stacked duplicate axis labels. */
  const dedupeZonesForDraw = (zones: UserBounceZone[]): UserBounceZone[] => {
    // Two zones in the same 15% price band → keep only the stronger one.
    const RANGE_FRAC = 0.15;
    // Absolute maximum lines ever drawn on the chart.
    const MAX_DRAW = 3;

    if (zones.length === 0) return [];

    // Step 1: sort by strength descending so the strongest zone in each band wins.
    const byStrength = [...zones].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));

    // Step 2: greedy keep — add a zone only if no already-kept zone is within RANGE_FRAC.
    const kept: UserBounceZone[] = [];
    for (const z of byStrength) {
      if (z.price <= 0) continue;
      const tooClose = kept.some(
        (k) => Math.abs(k.price - z.price) / Math.min(k.price, z.price) < RANGE_FRAC,
      );
      if (!tooClose) kept.push({ ...z });
      if (kept.length >= MAX_DRAW) break;
    }

    return kept;
  };

  const redrawBounceLinesOnSeries = (s: ISeriesApi<"Candlestick">) => {
    const mint = mintLoadedRef.current;
    if (!mint) return;
    const raw = bounceZonesRef.current.filter((z) => z.mint === mint && z.enabled);
    const zones = dedupeZonesForDraw(raw);
    bouncePriceLineHandlesRef.current.clear();
    const si = s as unknown as { _bounceLines?: BouncePriceLineHandle[] };
    if (si._bounceLines) {
      for (const line of si._bounceLines) {
        try {
          s.removePriceLine(line);
        } catch {
          /* stale handle after setData — ignore */
        }
      }
    }
    si._bounceLines = [];
    // Track prices already drawn this pass — skip any that land within 15% of an existing line.
    const drawnPrices: number[] = [];
    for (const zone of zones) {
      if (zone.price <= 0) continue;
      // Hard check: never draw two lines within 15% of each other no matter what
      const tooClose = drawnPrices.some(
        (p) => Math.abs(p - zone.price) / Math.min(p, zone.price) < 0.15,
      );
      if (tooClose) continue;
      drawnPrices.push(zone.price);

      const sources = (zone as { sources?: string }).sources;
      const isAuto = sources != null;
      const opacity = Math.max(0.45, zone.strength ?? 0.55);
      const tfCount = isAuto ? sources!.split("+").length : 1;
      const color = `rgba(56,189,248,${opacity})`;
      const title = isAuto
        ? sources === "swing"
          ? "Swing low"
          : sources!.startsWith("swing+")
            ? `Swing · ${sources!.slice("swing+".length)}`
            : sources!
        : "zone";
      const line = s.createPriceLine({
        price: zone.price,
        color,
        lineWidth: tfCount >= 3 ? 2 : 1,
        lineStyle: isAuto ? 0 : 2,
        axisLabelVisible: true,
        title,
      });
      si._bounceLines.push(line);
      bouncePriceLineHandlesRef.current.set(zone.id, line);
    }
  };

  // Persist newly closed paper trades as they accumulate in the session.
  useEffect(() => {
    if (!paperScalper || !mintLoaded) return;
    const all = paperScalper.botTrades;
    const newCount = all.length;
    if (newCount <= lastPersistedPaperCountRef.current) return;
    const fresh = all.slice(lastPersistedPaperCountRef.current);
    lastPersistedPaperCountRef.current = newCount;
    const walletPk = getPumpPortalTradingWalletPubkey() ?? "paper";
    appendPersistedTrades(fresh.map((t) => ({ ...t, walletPk, mint: mintLoaded })));
  }, [paperScalper, mintLoaded, appendPersistedTrades]);

  // Reset paper persist counter when a new session starts or mint changes.
  useEffect(() => {
    lastPersistedPaperCountRef.current = 0;
  }, [scalperCutoffMs, mintLoaded]);

  useEffect(() => {
    if (tradingMode !== "real" || !algoSessionActive || tradingHalted) {
      prevLiveOpenRef.current = undefined;
      return;
    }
    if (!mintLoaded || liveState !== "open" || !paperScalper) return;

    const apiKey = getEffectivePumpPortalApiKey().trim();
    const open = paperScalper.currentTrade != null;
    const prev = prevLiveOpenRef.current;

    if (prev === undefined) {
      prevLiveOpenRef.current = open;
      return;
    }

    const now = Date.now();
    const minGap = 1500;

    const maybeBuy = !prev && open;
    // Only attempt a real sell if a real buy was actually confirmed on-chain.
    // Without this guard, a failed buy (400) would still flip prevLiveOpenRef=true
    // and trigger a phantom sell on the next exit signal → "could not find account".
    const maybeSell = prev && !open && realPositionOpenRef.current;

    if (maybeBuy || maybeSell) {
      // Debounce buys only — never skip a sell, or we end up holding an
      // untracked position and keep re-buying on every new entry signal.
      if (maybeBuy && now - lastLiveTxAtRef.current < minGap) {
        // Don't advance prevLiveOpenRef so this buy is retried next tick.
        return;
      }
      if (!apiKey) {
        setLivePumpPortalErr(
          appendPumpPortalTradingWalletHint("PumpPortal API key missing — add it in Setup."),
        );
        prevLiveOpenRef.current = open;
        return;
      }
      lastLiveTxAtRef.current = now;
      prevLiveOpenRef.current = open;
      // Clear real position flag as soon as a sell fires — even if it fails on-chain,
      // we don't want to re-buy while potentially still holding tokens.
      if (maybeSell) realPositionOpenRef.current = false;

      const action = maybeBuy ? "buy" : "sell";
      const tapeSnapshot = paperScalper.botTrades;
      const lastTape = tapeSnapshot[tapeSnapshot.length - 1];
      const exitReason =
        lastTape?.kind === "tape" ? lastTape.exitReason : "order_book_sell";

      void (async () => {
        const poolForTx =
          maybeBuy
            ? lightningPoolPreference
            : lastBuyVenueRef.current?.mint === mintLoaded && lastBuyVenueRef.current.pool
              ? lastBuyVenueRef.current.pool
              : lightningPoolPreference;

        const res = await postPumpPortalLightningTradeWithFallback(apiKey, {
          action,
          mint: mintLoaded,
          amount: maybeBuy ? scalperLiveBuySol : "100%",
          denominatedInSol: maybeBuy ? "true" : "false",
          slippage: scalperUserConfig.realSlippagePct,
          priorityFee: scalperUserConfig.realPriorityFeeSol,
          pool: poolForTx,
        });
        if (!res.ok) {
          const tried =
            res.attempts.length > 1 ? ` — venues tried: ${res.attempts.join(" → ")}` : "";
          setLivePumpPortalErr(appendPumpPortalTradingWalletHint(res.message + tried));
          // Buy failed — make sure we don't hold a phantom open position flag
          // that would trigger a sell for tokens we never received.
          if (maybeBuy) realPositionOpenRef.current = false;
          return;
        }
        setLivePumpPortalSig(`${action.toUpperCase()} confirming… ${res.signature}`);
        setLivePumpPortalErr(null);
        const { confirmed, err } = await confirmLightningTx(res.signature);
        if (!confirmed) {
          setLivePumpPortalSig(null);
          setLivePumpPortalErr(
            appendPumpPortalTradingWalletHint(err ?? "Tx did not confirm — check explorer"),
          );
          // Buy not confirmed — same as failed
          if (maybeBuy) realPositionOpenRef.current = false;
          return;
        }

        setLivePumpPortalSig(res.signature);

        if (maybeBuy) {
          // Buy confirmed on-chain — now we genuinely hold tokens
          realPositionOpenRef.current = true;
          pendingLiveBuySigRef.current = res.signature;
          lastBuyVenueRef.current = { mint: mintLoaded, pool: res.poolUsed };
          return;
        }

        // realPositionOpenRef was already cleared synchronously when the sell was dispatched
        lastBuyVenueRef.current = null;

        const buySig = pendingLiveBuySigRef.current;
        pendingLiveBuySigRef.current = null;
        const walletPk = getPumpPortalTradingWalletPubkey();

        if (!buySig) {
          setLivePumpPortalErr(
            appendPumpPortalTradingWalletHint(
              "Sell landed on-chain but session had no confirmed buy signature — add PnL row from Solscan manually if needed.",
            ),
          );
          return;
        }

        if (!walletPk) {
          setLivePumpPortalErr(
            appendPumpPortalTradingWalletHint(
              "Sell confirmed — paste your PumpPortal trading wallet secret in Setup to log on-chain SOL PnL automatically.",
            ),
          );
          return;
        }

        const buyDelta = await fetchWalletSolDeltaSol(buySig, walletPk);
        const sellDelta = await fetchWalletSolDeltaSol(res.signature, walletPk);

        if (buyDelta == null || sellDelta == null) {
          setLivePumpPortalErr(
            appendPumpPortalTradingWalletHint(
              "Sell confirmed — RPC could not read wallet balance deltas yet. Retry Solscan or check your RPC / Helius key.",
            ),
          );
          return;
        }

        const solSpent = Math.max(0, -buyDelta);
        const solReceived = Math.max(0, sellDelta);
        const netSol = buyDelta + sellDelta;
        const roiPct = solSpent > 0 ? (netSol / solSpent) * 100 : 0;

        setLivePumpPortalErr(null);
        const chainTrade: BotTradeRowChain = {
          kind: "chain",
          id: `chain-${res.signature}`,
          closedAtTs: Date.now(),
          exitReason,
          buySignature: buySig,
          sellSignature: res.signature,
          solSpent,
          solReceived,
          netSol,
          roiPct,
        };
        setLiveChainTrades((prev) => [...prev, chainTrade]);
        appendPersistedTrades([{
          ...chainTrade,
          walletPk: walletPk,
          mint: mintLoaded,
        }]);
      })();
      return;
    }

    prevLiveOpenRef.current = open;
  }, [
    paperScalper,
    tradingMode,
    algoSessionActive,
    tradingHalted,
    mintLoaded,
    liveState,
    scalperLiveBuySol,
    lightningPoolPreference,
    scalperUserConfig.realSlippagePct,
    scalperUserConfig.realPriorityFeeSol,
    appendPersistedTrades,
  ]);

  useEffect(() => {
    setChartAnalytics({
      mint: mintLoaded ?? streamMint,
      chartLoading: loading,
      chartError: error,
      yMcCap: mintLoaded ? yMcCap : null,
      chartInterval: mintLoaded || streamMint ? chartInterval : null,
      lastCandle: lastCandleSummary,
      tapeSummary,
      tokenSupplyUi: mintLoaded ? tokenUiSupply : null,
      orderBookConn: liveState,
      orderBookError: liveErr,
      orderBookLastTradeAt: liveLastTradeAt,
      paperScalper,
      livePumpPortalLastSig: livePumpPortalSig,
      livePumpPortalLastErr: livePumpPortalErr,
      realBotTrades: tradingMode === "real" ? liveChainTrades : [],
    });
  }, [
    mintLoaded,
    streamMint,
    loading,
    error,
    yMcCap,
    chartInterval,
    lastCandleSummary,
    tapeSummary,
    tokenUiSupply,
    liveState,
    liveErr,
    liveLastTradeAt,
    paperScalper,
    livePumpPortalSig,
    livePumpPortalErr,
    liveChainTrades,
    tradingMode,
    setChartAnalytics,
  ]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: FG,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontSize: 12,
      },
      localization: {
        locale: "en-US",
        priceFormatter: (price: number) => formatUsdCompact(price),
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      rightPriceScale: {
        borderColor: GRID,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: GRID,
        timeVisible: true,
        secondsVisible: false,
        lockVisibleTimeRangeOnResize: true,
        /** Empty “future” rails on the right so the last candle isn’t glued to the price scale. */
        rightOffset: 14,
        /** User pans freely; live `setData` must not yank the window when new ticks arrive. */
        shiftVisibleRangeOnNewBar: false,
        fixRightEdge: false,
        fixLeftEdge: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CROSSHAIR,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: CROSSHAIR_LABEL_BG,
        },
        horzLine: {
          color: CROSSHAIR,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: CROSSHAIR_LABEL_BG,
        },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    seriesMarkersPluginRef.current = createSeriesMarkers(series, [], {
      autoScale: true,
      zOrder: "aboveSeries",
    });

    // ── Lazy historical load on pan-left ─────────────────────────────────────
    // Start fetching an older chunk when the user pans within LOAD_TRIGGER_BARS
    // of the oldest loaded candle (or past it into empty space). Each triggered
    // fetch is completely isolated — one independent request with its own cursor.
    // Works for all intervals: 1s, 1m, 5m, 15m.
    const LOAD_TRIGGER_BARS = 200;

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || range.from >= LOAD_TRIGGER_BARS) return;
      if (isFetchingOlderRef.current || hasReachedGenesisRef.current) return;
      const mint = mintLoadedRef.current;
      if (!mint) return;
      const oldestTs = oldestLoadedTsRef.current;
      if (oldestTs == null) return;

      isFetchingOlderRef.current = true;

      // Each call is fully isolated — if it fails, the next pan-left retries.
      void fetchPumpCandles(mint, {
        interval: chartIntervalRef.current,
        beforeTs: oldestTs * 1000 - 1, // seconds → ms, step back 1 ms before oldest bar
      }).then((result) => {
        isFetchingOlderRef.current = false;

        // Fewer raw fetched bars than the max means we've reached the token's genesis.
        // Use rawFetchedCount (not candles.length) so resampled intervals like "5s"
        // (which compress 1000 1s candles → ~200 5s bars) don't falsely trigger genesis.
        if (result.rawFetchedCount < PUMP_CANDLES_MAX_LIMIT) {
          hasReachedGenesisRef.current = true;
        }

        if (result.candles.length > 0) {
          // Merge older chunk into baseRows — triggers chart setData + scroll preserve.
          setBaseRows((prev) => mergeBaseCandles(prev, result.candles));
        }
      }).catch(() => {
        // Release guard on error so the next pan-left can retry.
        isFetchingOlderRef.current = false;
      });
    });

    return () => {
      seriesMarkersPluginRef.current?.detach();
      seriesMarkersPluginRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  /** Axis labels + crosshair use the viewer’s zone (auto) or a chosen IANA zone. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
    const showSeconds = bucketSec < 60;
    chart.applyOptions({
      localization: {
        locale,
        priceFormatter: (price: number) => formatUsdCompact(price),
        timeFormatter: (t: Time) => formatChartCrosshairTime(t, effectiveTz, locale, showSeconds),
      },
      timeScale: {
        secondsVisible: showSeconds,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType, loc: string) =>
          formatChartTickMark(time, tickMarkType, loc, effectiveTz),
      },
    });
  }, [effectiveTz, bucketSec]);

  useEffect(() => {
    return () => {
      setChartAnalytics({ paperScalper: null });
    };
  }, [setChartAnalytics]);

  useEffect(() => {
    const mint = normalizeMint(caMintInput);
    const t = window.setTimeout(() => {
      setDebouncedMint(mint && looksLikeSolMint(mint) ? mint : "");
    }, 450);
    return () => window.clearTimeout(t);
  }, [caMintInput]);

  useEffect(() => {
    didFitRef.current = false;
  }, [mintLoaded, chartInterval]);

  // How many pages to fetch based on interval — more pages for shorter candles.
  const pagesForInterval = (iv: ChartInterval) =>
    iv === "1s" || iv === "5s" ? 10 : iv === "1m" ? 5 : 3;

  useEffect(() => {
    // Reset lazy-load cursors whenever mint or interval changes.
    isFetchingOlderRef.current = false;
    hasReachedGenesisRef.current = false;
    oldestLoadedTsRef.current = null;
    // Allow a fresh auto-detect run for the new mint/interval.
    autoDetectedMintRef.current = "";

    if (!debouncedMint) {
      fetchGenRef.current += 1;
      setMintLoaded(null);
      setBaseRows([]);
      setTokenUiSupply(null);
      setError(null);
      setLoading(false);
      return;
    }

    const gen = ++fetchGenRef.current;

    // Serve from cache immediately (no loading flash on tab re-visits).
    const cached = getCachedCandles(debouncedMint, chartInterval);
    if (cached) {
      setMintLoaded(debouncedMint);
      setYMcCap(cached.yAxisIsMarketCapUsd);
      if (cached.tokenUiSupply != null) setTokenUiSupply(cached.tokenUiSupply);
      setBaseRows(cached.candles);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setBaseRows([]);

    void (async () => {
      try {
        const result = await fetchPumpCandlesPaged(debouncedMint, {
          interval: chartInterval,
          pages: pagesForInterval(chartInterval),
        });
        if (gen !== fetchGenRef.current) return;
        setCachedCandles(debouncedMint, chartInterval, result);
        setMintLoaded(debouncedMint);
        setYMcCap(result.yAxisIsMarketCapUsd);
        setTokenUiSupply(result.tokenUiSupply);
        setBaseRows(result.candles);
      } catch (e) {
        if (gen !== fetchGenRef.current) return;
        setMintLoaded(null);
        setBaseRows([]);
        setTokenUiSupply(null);
        setError(e instanceof Error ? e.message : "Failed to load candles.");
      } finally {
        if (gen === fetchGenRef.current) setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMint, chartInterval]);

  useEffect(() => {
    if (!mintLoaded) return;
    let cancelled = false;
    const poll = window.setInterval(() => {
      void (async () => {
        try {
          // Fetch only the latest page and MERGE into the existing base rows so
          // the full history (up to 10 k candles) is never discarded by a poll.
          const { candles: fresh, yAxisIsMarketCapUsd, tokenUiSupply: supply } =
            await fetchPumpCandles(mintLoaded, { interval: chartInterval });
          if (cancelled) return;
          setBaseRows((prev) => mergeBaseCandles(prev, fresh));
          setYMcCap(yAxisIsMarketCapUsd);
          if (supply != null) setTokenUiSupply(supply);
        } catch {
          /* keep last series */
        }
      })();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [mintLoaded, chartInterval]);

  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart || chartRows.length === 0) return;

    const ts = chart.timeScale();
    /**
     * Gap from the chart’s right edge to the latest bar (in bar widths). Unlike `setVisibleRange`,
     * this survives `setData` without clamping `to` onto the last candle — so zoom-out “air” on the
     * right stays put across live merges and REST polls.
     */
    const scrollBefore = ts.scrollPosition();

    const baseRowsChanged = baseRows !== prevBaseRowsRef.current;
    prevBaseRowsRef.current = baseRows;

    if (baseRowsChanged) {
      // Full REST refresh: setData wipes all createPriceLine handles — re-draw immediately after.
    s.setData(chartRows);
      redrawBounceLinesOnSeries(s);
    } else {
      // Live tick only: series.update() preserves price lines, no re-draw needed.
      const last = chartRows[chartRows.length - 1];
      if (last) s.update(last);
    }

    if (!didFitRef.current) {
      ts.fitContent();
      didFitRef.current = true;
      return;
    }

    const restoreScroll = () => {
      try {
        ts.scrollToPosition(scrollBefore, false);
        } catch {
        /* ignore */
      }
    };

    restoreScroll();
    requestAnimationFrame(() => {
      restoreScroll();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRows]);

  // Prefetch 3 × 1000 candles at the **same interval as the chart** for bounce detection.
  // Detection fires automatically once rows are ready (no button click needed).
  useEffect(() => {
    if (!mintLoaded) {
      setFloorDetectionRows([]);
      setFloorCandlesStatus("idle");
      return;
    }
    const gen = ++floorFetchGenRef.current;
    setFloorDetectionRows([]);
    setFloorCandlesStatus("loading");
    void (async () => {
      try {
        // Fetch 1s candles for floor detection — most granular view for
        // ZigZag algo + vision API. Use the in-memory cache if it's warm
        // (chart initial load already fetched these), else paginate fresh.
        // 10 pages × 1000 bars = 10,000 × 1 s ≈ 2.8 h of price history.
        const cached1s = getCachedCandles(mintLoaded, "1s");
        const { candles } = cached1s ?? await fetchPumpCandlesPaged(mintLoaded, {
          interval: "1s",
          pages: 10,
        });
        if (gen !== floorFetchGenRef.current) return;
        setFloorDetectionRows(candles);
        setFloorCandlesStatus("ready");
      } catch {
        if (gen !== floorFetchGenRef.current) return;
        setFloorCandlesStatus("ready"); // let user try anyway; detection handles empty rows
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintLoaded, chartInterval]);

  // Track the last manual-refresh tick so we can distinguish user clicks from
  // effect re-runs triggered by candle updates.
  const prevBounceSuggestionTickRef = useRef(0);
  // Per-mint flag: once we auto-detect on first load we never auto-detect again
  // for that mint (until a new CA is entered). Vision always stays manual-only.
  const autoDetectedMintRef = useRef<string>("");

  // Bounce zone detection.
  //   • First load for a mint  → algo runs automatically (free, no API credits).
  //   • Manual "Refresh" click → algo + vision both run (costs API credits).
  //   • Subsequent candle polls → neither runs (isManualRefresh=false AND mint already auto-detected).
  useEffect(() => {
    if (!mintLoaded || floorDetectionRows.length < MIN_BOOTSTRAP_CANDLES) return;

    const isManualRefresh = bounceSuggestionTick > prevBounceSuggestionTickRef.current;
    prevBounceSuggestionTickRef.current = bounceSuggestionTick;

    const isFirstLoad = autoDetectedMintRef.current !== mintLoaded;

    // Nothing to do — not a manual click and this mint was already auto-detected.
    if (!isManualRefresh && !isFirstLoad) return;

    const currentPrice = floorDetectionRows[floorDetectionRows.length - 1]?.close;
    const algoZones = detectBounceZones(floorDetectionRows, currentPrice);
    setDetectedZones(mintLoaded, algoZones);

    if (isFirstLoad) {
      // Mark this mint as auto-detected so subsequent poll re-runs are ignored.
      autoDetectedMintRef.current = mintLoaded;
      // Stop here on first load — vision is credit-burning and stays manual only.
      return;
    }

    // --- Manual refresh path: also run vision detection ---
    if (!model.apiKey.trim()) return;

    setChartAnalytics({ visionDetectStatus: "loading", visionDetectError: null });

    void detectBounceZonesVision(floorDetectionRows, model, currentPrice).then((result) => {
      if (result.ok && result.prices.length > 0) {
        const mintNow = mintLoaded;
        const modelTag = result.modelUsed.split("/").pop()?.slice(0, 12) ?? "ai";
        const visionOnlyZones = result.prices.map((price) => ({
          price,
          confluenceScore: 0.5,
          sources: `vision·${modelTag}`,
          strength: 0.5,
          lastTouchAgo: 0,
          isSupport: true,
          touches: 0,
        }));
        setDetectedZones(mintNow, [...algoZones, ...visionOnlyZones]);
        setChartAnalytics({ visionDetectStatus: "done", visionDetectError: null });
      } else {
        setChartAnalytics({
          visionDetectStatus: result.ok ? "done" : "error",
          visionDetectError: result.ok ? null : result.error,
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorDetectionRows, mintLoaded, bounceSuggestionTick, chartInterval, setDetectedZones]);

  // Draw bounce zone price lines on the chart — fires when zones are (re)computed or mint changes.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !mintLoaded) return;

    // Explicitly remove old lines before re-drawing (in case setData wasn't called this cycle).
    const si = series as unknown as { _bounceLines?: BouncePriceLineHandle[] };
    if (si._bounceLines) {
      for (const line of si._bounceLines) {
        try { series.removePriceLine(line); } catch { /* ignore */ }
      }
    }

    redrawBounceLinesOnSeries(series);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounceZones, mintLoaded]);

  // Drag bounce zone lines: pointer capture + disable chart pan/zoom while dragging;
  // move the native price line directly — React state updates once on release (smooth).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const SNAP_PX = 10;

    const endDrag = () => {
      const chart = chartRef.current;
      const id = draggingZoneIdRef.current;
      const price = pendingDragPriceRef.current;
      const pid = dragPointerIdRef.current;

      draggingZoneIdRef.current = null;
      dragPointerIdRef.current = null;
      pendingDragPriceRef.current = null;
      host.style.cursor = "";

      if (chart) {
        chart.applyOptions({ handleScroll: true, handleScale: true });
      }
      if (pid != null) {
        try {
          host.releasePointerCapture(pid);
        } catch {
          /* not capturing */
        }
      }
      if (id != null && price != null && price > 0) {
        // Hard clamp: zone can never be at or above 93 % of live price (7 % minimum gap).
        const liveNow = livePriceRef.current;
        const clamped = liveNow != null && liveNow > 0
          ? Math.min(price, liveNow * 0.93)
          : price;
        updateBounceZonePriceRef.current(id, clamped);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const chart = chartRef.current;
      const series = seriesRef.current;
      const mint = mintLoadedRef.current;
      if (!chart || !series || !mint) return;

      const rect = host.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const zones = bounceZonesRef.current.filter((z) => z.mint === mint && z.enabled);
      for (const zone of zones) {
        const lineY = series.priceToCoordinate(zone.price);
        if (lineY != null && Math.abs(y - lineY) <= SNAP_PX) {
          e.preventDefault();
          e.stopPropagation();
          chart.applyOptions({ handleScroll: false, handleScale: false });
          draggingZoneIdRef.current = zone.id;
          dragPointerIdRef.current = e.pointerId;
          pendingDragPriceRef.current = zone.price;
          host.setPointerCapture(e.pointerId);
          host.style.cursor = "ns-resize";
      return;
    }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const series = seriesRef.current;
      const id = draggingZoneIdRef.current;
      const rect = host.getBoundingClientRect();
      const y = e.clientY - rect.top;

      if (id && series) {
        const price = series.coordinateToPrice(y);
        const handle = bouncePriceLineHandlesRef.current.get(id);
        if (price != null && price > 0 && handle) {
          handle.applyOptions({ price });
          pendingDragPriceRef.current = price;
        }
        return;
      }

      const mint = mintLoadedRef.current;
      if (!series || !mint) return;
      const zones = bounceZonesRef.current.filter((z) => z.mint === mint && z.enabled);
      const near = zones.some((zone) => {
        const lineY = series.priceToCoordinate(zone.price);
        return lineY != null && Math.abs(y - lineY) <= SNAP_PX;
      });
      host.style.cursor = near ? "ns-resize" : "";
    };

    const onWindowPointerEnd = (e: PointerEvent) => {
      if (dragPointerIdRef.current !== e.pointerId) return;
      endDrag();
    };

    host.addEventListener("pointerdown", onPointerDown, { capture: true });
    host.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);

    return () => {
      const chart = chartRef.current;
      const pid = dragPointerIdRef.current;
      draggingZoneIdRef.current = null;
      dragPointerIdRef.current = null;
      pendingDragPriceRef.current = null;
      host.style.cursor = "";
      if (chart) {
        chart.applyOptions({ handleScroll: true, handleScale: true });
      }
      if (pid != null) {
        try {
          host.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
      }
      host.removeEventListener("pointerdown", onPointerDown, { capture: true });
      host.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
    };
  }, []);

  useEffect(() => {
    const api = seriesMarkersPluginRef.current;
    if (!api) return;

    if (
      !scalperEngineRunning ||
      !paperScalper ||
      paperScalper.paperMarkers.length === 0 ||
      chartRows.length === 0
    ) {
      api.setMarkers([]);
      return;
    }

    const lw: SeriesMarker<UTCTimestamp>[] = [];
    for (const m of paperScalper.paperMarkers) {
      const barT = alignPaperMarkerToBars(m.timeSec, bucketSec, chartRows);
      if (barT == null) continue;
      lw.push({
        time: barT as UTCTimestamp,
        position: m.side === "buy" ? "belowBar" : "aboveBar",
        shape: "circle",
        color: m.side === "buy" ? UP : DOWN,
        size: 0.55,
        id: `${m.side}-${m.timeSec}-${barT}`,
      });
    }
    lw.sort((a, b) => (a.time as number) - (b.time as number));
    api.setMarkers(lw);
  }, [paperScalper, scalperEngineRunning, chartRows, bucketSec]);

  return (
    <div
      className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-2xl"
      style={{ background: "var(--color-bg-editor)" }}
    >
      <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-1.5">
        <div className="flex flex-col gap-1.5 rounded-xl border border-[color-mix(in_srgb,#2EA8FF_22%,var(--color-border))] bg-[linear-gradient(135deg,rgba(46,168,255,0.07)_0%,rgba(255,255,255,0.015)_50%,rgba(255,106,106,0.03)_100%)] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:flex-row sm:items-center sm:gap-2.5 sm:py-1">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[13px] font-semibold tracking-tight text-[var(--color-fg-heading)]">Add CA</span>
            <span
              className="hidden max-w-[11rem] truncate text-[11px] leading-tight text-[var(--color-fg-dim)] sm:inline lg:max-w-[14rem]"
              title="Paste a mint — chart and tape load automatically."
            >
              Paste mint · chart loads ✨
            </span>
          </div>
          <div className="relative flex min-w-0 flex-1 items-center gap-2">
            <input
              id="ca-mint-input"
              className="unt-input h-8 min-h-8 w-full min-w-0 flex-1 py-1.5 font-mono text-[12px] leading-tight"
              placeholder="Mint address…"
              title="Paste a Pump.fun mint — chart and tape load automatically."
              value={caMintInput}
              onChange={(e) => setCaMintInput(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Contract address (mint)"
            />
            {loading ? (
              <span className="shrink-0 text-[10px] font-medium tabular-nums text-[var(--color-fg-dim)]" aria-live="polite">
                Loading
              </span>
            ) : null}
          </div>
        </div>
      </div>

        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
          <span className="unt-strip-heading shrink-0">Timeframe</span>
            <div className="flex flex-wrap gap-1">
              {CHART_INTERVALS.map((iv) => {
                const active = chartInterval === iv;
                return (
                  <button
                    key={iv}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setChartInterval(iv)}
                    className={[
                      "rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors",
                      active
                      ? "border-[color-mix(in_srgb,var(--color-fg)_18%,transparent)] bg-[color-mix(in_srgb,#2EA8FF_14%,transparent)] text-[var(--color-fg)]"
                        : "border-[var(--color-border)] bg-transparent text-[var(--color-fg-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]",
                    ].join(" ")}
                  >
                    {iv}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      <TokenInfoBar mint={streamMint} />

      {error ? (
        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-[14px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      {liveErr && streamMint && !error ? (
        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-[13px] text-amber-300/95">
          PumpPortal: {liveErr}
        </div>
      ) : null}

      {mintLoaded && !error ? (
        <div
          className={
            "flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5 " +
            (tradingMode === "real" && scalperEngineRunning && livePumpPortalErr
              ? "border-red-500/40 bg-[color-mix(in_srgb,red_14%,var(--color-fill)_50%)] shadow-[inset_0_1px_0_rgba(248,113,113,0.12)]"
              : tradingMode === "real" && scalperEngineRunning
                ? "border-amber-500/35 bg-[color-mix(in_srgb,#f59e0b_12%,var(--color-fill)_55%)] shadow-[inset_0_1px_0_rgba(251,191,36,0.1)]"
                : "border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-fill)_55%,transparent)]")
          }
        >
          <div className="min-w-0 flex-1">
            {chartSessionNotice ? (
              <p className="mb-2 whitespace-pre-wrap text-[12px] font-medium text-amber-300/95">{chartSessionNotice}</p>
            ) : null}
            {scalperEngineRunning ? (
              <div className="flex flex-col gap-1">
                <span
                  className={
                    "text-[13px] font-semibold " +
                    (tradingMode === "real"
                      ? livePumpPortalErr
                        ? "text-red-100/95"
                        : "text-amber-100/95"
                      : "text-teal-200/95")
                  }
                >
                  {tradingMode === "real" ? "Real trading live" : "Paper trading live"}
          </span>
                {tradingMode === "real" ? (
                  <>
                    <p className="text-[11px] leading-snug text-[var(--color-fg-dim)]">
                      Lightning venue {lightningPoolPreference}
                      {SCALPER_PAPER_CONFIG.realPool === "auto" ? " (retries pump-amm → raydium on migrate)" : ""} · ~
                      {scalperLiveBuySol} SOL entries
                    </p>
                    {livePumpPortalSig ? (
                      <p className="font-mono text-[10px] text-emerald-400/90">
                        Last signature {livePumpPortalSig.slice(0, 10)}…{livePumpPortalSig.slice(-8)}
                      </p>
                    ) : null}
                    {livePumpPortalErr ? (
                      <p className="whitespace-pre-wrap text-[11px] leading-snug text-red-400/95">{livePumpPortalErr}</p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : tradingMode === "real" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-[var(--color-fg-heading)]">
                    Real · PumpPortal wallet
          </span>
        </div>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-fg-dim)]">
                  Entries fire ~{scalperLiveBuySol} SOL buys; exits sell 100% via PumpPortal Lightning (venue hint{" "}
                  {lightningPoolPreference}
                  {SCALPER_PAPER_CONFIG.realPool === "auto" ? "; auto-fallback on graduated curve" : ""}). Wallet =
                  the one linked to your Setup API key.
                </p>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className="unt-btn-primary shrink-0 px-4 py-2 text-[13px] font-medium"
              disabled={!scalperEngineRunning && selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID}
              title={
                !scalperEngineRunning && selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID
                  ? "Select Order-book scalper under Dashboard, then Start here or in the sidebar"
                  : undefined
              }
            onClick={() => {
                if (scalperEngineRunning) {
                  hardStopTrading();
                return;
              }
                if (selectedAlgoId !== BUILTIN_SCALPER_PRESET_ID) return;
                if (tradingMode === "real" && !getEffectivePumpPortalApiKey().trim()) {
                  setChartSessionNotice(
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
              {scalperEngineRunning ? "Stop" : "Start"}
          </button>
          </div>
        </div>
      ) : null}

      <div className="relative flex h-0 min-h-[200px] w-full flex-[2] basis-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="absolute inset-0" />
        </div>
        <div
          className="pointer-events-none relative z-[6] flex h-9 shrink-0 items-center justify-end border-t px-3"
          style={{ borderColor: GRID, backgroundColor: BG }}
        >
          <ChartTimezoneHud chartTzChoice={chartTzChoice} onPickChoice={setChartTzChoice} />
        </div>
      </div>

      {streamMint ? (
        <PumpOrderBook
          rows={liveRowsForMc}
          state={liveState}
          error={liveErr}
          yMcCap={yMcCap}
        />
      ) : null}
    </div>
  );
}

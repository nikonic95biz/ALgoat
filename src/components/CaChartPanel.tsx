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
import { PumpOrderBook } from "@/components/PumpOrderBook";
import { useApp, type ChartCandleBarSummary, type ChartTapeSummary } from "@/context/AppContext";
import { usePumpPortalTrades } from "@/hooks/usePumpPortalTrades";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import {
  CHART_INTERVALS,
  chartIntervalBucketSec,
  fetchPumpCandles,
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
import { reduceScalperPaper } from "@/lib/scalperPaperEngine";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import {
  appendPumpPortalTradingWalletHint,
  getEffectivePumpPortalApiKey,
} from "@/lib/pumpPortalConfig";
import { postPumpPortalLightningTrade } from "@/lib/pumpPortalLightningTrade";

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
  } = useApp();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesMarkersPluginRef = useRef<ISeriesMarkersPluginApi<any> | null>(null);
  const fetchGenRef = useRef(0);
  const didFitRef = useRef(false);

  const [debouncedMint, setDebouncedMint] = useState("");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("1m");
  const [chartTzChoice, setChartTzChoice] = useState<ChartTimezoneChoice>(() => loadChartTimezoneChoice());
  const [scalperCutoffMs, setScalperCutoffMs] = useState<number | null>(null);
  const [livePumpPortalSig, setLivePumpPortalSig] = useState<string | null>(null);
  const [livePumpPortalErr, setLivePumpPortalErr] = useState<string | null>(null);
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
  const [yMcCap, setYMcCap] = useState(true);
  /** SPL minted supply (`getTokenSupply` uiAmount) when RPC succeeded. */
  const [tokenUiSupply, setTokenUiSupply] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    rows: liveRows,
    state: liveState,
    error: liveErr,
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
  }, [algoSessionActive, selectedAlgoId, mintLoaded, tradingMode]);

  useEffect(() => {
    if (tradingMode !== "real" || !algoSessionActive) {
      setLivePumpPortalSig(null);
      setLivePumpPortalErr(null);
    }
  }, [tradingMode, algoSessionActive]);

  const paperScalper = useMemo(() => {
    if (!scalperEngineRunning || !mintLoaded || scalperCutoffMs == null) return null;
    return reduceScalperPaper(liveRowsForMc, { minTradeTsMs: scalperCutoffMs });
  }, [scalperEngineRunning, mintLoaded, liveRowsForMc, scalperCutoffMs]);

  const prevLiveOpenRef = useRef<boolean | undefined>(undefined);
  const lastLiveTxAtRef = useRef(0);

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
    const maybeSell = prev && !open;

    if (maybeBuy || maybeSell) {
      if (now - lastLiveTxAtRef.current < minGap) {
        prevLiveOpenRef.current = open;
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

      const R = SCALPER_PAPER_CONFIG;
      void (async () => {
        const res = await postPumpPortalLightningTrade(apiKey, {
          action: maybeBuy ? "buy" : "sell",
          mint: mintLoaded,
          amount: maybeBuy ? scalperLiveBuySol : "100%",
          denominatedInSol: maybeBuy ? "true" : "false",
          slippage: R.realSlippagePct,
          priorityFee: R.realPriorityFeeSol,
          pool: R.realPool,
        });
        if (res.ok) {
          setLivePumpPortalSig(res.signature);
          setLivePumpPortalErr(null);
        } else {
          setLivePumpPortalErr(appendPumpPortalTradingWalletHint(res.message));
        }
      })();
      return;
    }

    prevLiveOpenRef.current = open;
  }, [paperScalper, tradingMode, algoSessionActive, tradingHalted, mintLoaded, liveState, scalperLiveBuySol]);

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
      paperScalper,
      livePumpPortalLastSig: livePumpPortalSig,
      livePumpPortalLastErr: livePumpPortalErr,
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
    paperScalper,
    livePumpPortalSig,
    livePumpPortalErr,
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

  useEffect(() => {
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
    setLoading(true);
    setError(null);
    setBaseRows([]);

    void (async () => {
      try {
        const { candles, yAxisIsMarketCapUsd, tokenUiSupply: supply } =
          await fetchPumpCandles(debouncedMint, { interval: chartInterval });
        if (gen !== fetchGenRef.current) return;
        setMintLoaded(debouncedMint);
        setYMcCap(yAxisIsMarketCapUsd);
        setTokenUiSupply(supply);
        setBaseRows(candles);
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
  }, [debouncedMint, chartInterval]);

  useEffect(() => {
    if (!mintLoaded) return;
    let cancelled = false;
    const poll = window.setInterval(() => {
      void (async () => {
        try {
          const { candles, yAxisIsMarketCapUsd, tokenUiSupply: supply } =
            await fetchPumpCandles(mintLoaded, { interval: chartInterval });
          if (cancelled) return;
          setBaseRows(candles);
          setYMcCap(yAxisIsMarketCapUsd);
          setTokenUiSupply(supply);
        } catch {
          /* keep last series */
        }
      })();
    }, 4000);
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

    s.setData(chartRows);

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
  }, [chartRows]);

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
                      Lightning pool {SCALPER_PAPER_CONFIG.realPool} · ~{scalperLiveBuySol} SOL entries
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
                  Entries fire ~{scalperLiveBuySol} SOL buys; exits sell 100% via PumpPortal Lightning API
                  (pool: {SCALPER_PAPER_CONFIG.realPool}). Wallet = the one linked to your Setup API key.
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

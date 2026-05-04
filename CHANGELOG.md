# Changelog

## v1.1 — 2026-05-04

**Public route:** engineering changelog is browseable at **`{BASE_PATH}/changelog`** (production example: [enrich.fun/solclaw/changelog](https://enrich.fun/solclaw/changelog)). Implementation: `ReleaseNotesPage.tsx`, routing in `App.tsx`, `changelogPath()` in `siteUrls.ts`.

### Bounce Zone Engine

- **Algo detection auto-fires on first chart load** (zero API cost). Vision detection (LLM) is now strictly manual-only — clicking "Refresh bounce lines" is the only thing that triggers an API call, so users never burn credits without consent.
- **7 % hard floor on all bounce zones.** A zone can never be placed within 7 % of the current price — enforced in the algo engine (`FLOOR_MARGIN_FRAC = 0.07`), the vision post-filter (`livePx * 0.93`), manual drag clamp, and the `addBounceZone` / `updateBounceZonePrice` helpers in `AppContext`. Zones above current price are blocked at every entry point.
- **`dedupeZonesForDraw` rewritten** — greedy pass keeps the strongest zone in any 15 % window, discards all others. A second hard guard at draw time (inside `redrawBounceLinesOnSeries`) prevents a second `createPriceLine` if any already-drawn line is within 15 %. Same range now always shows at most one line.
- **`detectBounceZones` gets a sparse-history bootstrap** (`bootstrapSparseHistoryZones`) that fires for tokens with fewer than `MIN_BOOTSTRAP_CANDLES` bars, so freshly launched pairs (< 60 s old, 6 k MC ATH) still get sensible suggestions.
- `MAX_ZONES` capped at 2 for algo, `MAX_DRAW` capped at 3 for drawing. "Less is more" — two clean levels beat six noisy ones.

### Vision / LLM Bounce Detection (BETA)

- **`src/lib/visionBounceDetect.ts`** — new module. Renders an offscreen `lightweight-charts` candlestick chart of all loaded candles (fit-to-content), composites multiple canvas layers, and submits the image to the user's LLM (Anthropic, OpenAI, Gemini) for visual support-level analysis.
- Prompt rewritten to be highly prescriptive: 4 named bounce patterns, strict "at most 2–3 zones, ≥ 15 % apart, strictly ≥ 7 % below current price, never resistance, exact wick low" rules.
- Hard post-filter removes any price returned by the LLM that is `>= livePx * 0.93`.
- Routes through the existing `resolveLlmApiUrl` Vite dev proxy — no CORS issues on localhost; direct on deployed sites.
- Adds `"anthropic-dangerous-direct-browser-access": "true"` header for Anthropic calls.
- **BETA badge** on the "Refresh bounce lines" button — blue/cyan gradient with a CSS `@keyframes` pulse so it's visible at a glance.
- Warning strip inside the Bounce zones card: "⚠ Check API credit spend — still optimizing". Tooltip fires when no LLM key is configured.

### Candle Loading & Caching

- **Viewport-triggered lazy loading** for all timeframes (1 s, 5 s, 1 m, 5 m, 15 m). `chart.timeScale().subscribeVisibleLogicalRangeChange` fires a `fetchPumpCandles(beforeTs)` request as the user pans within 200 bars of the oldest loaded timestamp. Each request is isolated and deduplicated via `isFetchingOlderRef`. `hasReachedGenesisRef` stops fetching once the API returns a partial page.
- **`PUMP_CANDLES_MAX_LIMIT` = 1 000.** Initial load uses `fetchPumpCandlesPaged` — 10 pages for 1 s/5 s charts, 5 pages for 1 m, 3 pages for 5 m/15 m.
- **`_candleCache`** — in-memory `Map` keyed by `${mint}:${interval}` with 90 s TTL. Tab re-visits and timeframe toggles serve from cache instantly with no loading flash.
- **`mergeBaseCandles` fixed (v2)** — periodic 30 s REST polls now only update the **last 1–2 bars** (the current building bar and the one before it). Historical bars are immutable from the poll's perspective. Combining differently-scaled MC responses across all overlapping bars was the root cause of stretched / "comb" candles.
- **5 s chart added.** Client-side resampling: `resampleCandles` converts 1 s raw candles into 5 s buckets. `PumpCandlesResult.rawFetchedCount` propagates the raw count for correct genesis detection on resampled intervals.
- **5 s is now the default timeframe** for any newly entered CA.

### Scalper Engine

- **`"nearing"` state** — fires when price enters an asymmetric window around a bounce zone (3 % above, 0.25 % below). Removed the `anyDip > 2 %` prerequisite so the state triggers immediately on manual line moves.
- **Re-entry cooldown knob** (`reentryCooldownMs`, default 30 000 ms) — prevents back-to-back buys. Previously the cooldown was hardcoded and the double-buy bug could surface.
- **All scalper knobs are live-editable** while a session is active. Removed `disabled={locked}` from every `Knob` and replaced the "Stop session to edit" label with a "● live" indicator so traders can tune parameters mid-session.
- `catalystMinSol` changes now propagate immediately — no page reload needed.

### Real Trading

- **`postPumpPortalLightningTradeWithFallback`** — retries on `pump-amm` → `raydium` for `custom program error: 6005` (bonding curve completed / migrated to Raydium), falls back to `pump` for bonding-only errors. Pre-bond and post-bond coins both work.
- **`realPositionOpenRef`** — tracks confirmed on-chain buys. Phantom sells (400 Bad Request when no position is open) are now gated on this ref flipping `true` after successful on-chain confirmation.
- **"Sell All" button** — appears next to "Stop" only when `algoSessionActive && tradingMode === "real" && status === "in_trade"`. Calls `requestManualSell()` → `postPumpPortalLightningTradeWithFallback` → logs PnL → `hardStopTrading`.
- **PnL tracking tightened** — `fetchWalletSolDeltaSol` uses exponential backoff with up to 12 retry attempts (was 3). Returns `0` instead of `null` if the wallet isn't the signer — ensures every trade row is recorded with no guesswork.

### Performance Tab

- Completely rewritten as `PersistedTradesTable` — unified table for real and paper trades, sorted newest first.
- Columns: Age · Mode (Real/Paper badge) · Token (mint + copy) · Wallet · Outcome (ROI % real / MC Δ % paper) · Levels (SOL in/out real / entry-exit MC paper) · Est. (paper only) · Exit reason · Links (Solscan, Pump.fun, buy/sell tx).
- Rows tinted green/red on win/loss.
- **Copy CA feedback** — "Copy" button shows "✓ Copied" for 1 s then reverts.
- "Chart" navigation button removed; switching tabs on CA click eliminated.

### IDE-Like Chat Control

- **`src/lib/localWorkspace.ts`** — File System Access API wrapper. `openLocalWorkspace` triggers the browser folder-picker; `writeLocalFile` resolves nested paths and writes via `FileSystemDirectoryHandle`. Handle is persisted to `IndexedDB` across sessions via `persistHandle` / `loadPersistedHandle`.
- **`AppContext`** — `localWorkspaceHandle` state, `connectLocalWorkspace` / `disconnectLocalWorkspace` callbacks, `pendingLocalEdits` queue, `pushPendingToGitHub` batch-commit helper. `applyFileEdit` prefers local write (instant Vite HMR) over GitHub commit when a folder is connected.
- **`ChatPanel`** — "Write locally" button replaces "Apply" when a local workspace is connected. "Push N files to GitHub" badge appears in the footer when local edits are queued.
- **`parseChatEdits.ts`** — `parseConfigPatch` extracts ` ```config ``` ` fenced blocks from LLM responses and maps whitelisted numeric keys to `ScalperUserConfig`. Applied instantly via "Apply to knobs" button in the chat — no redeploy needed.
- **`composerSystemPrompt.ts`** — teaches the LLM when to emit a `config` block (live knob change) versus a code-edit block (UI/logic change).
- **`SetupPanel`** — "Local workspace (instant edits)" section with connect / disconnect controls and File System Access API availability guard.

### Chart Persistence

- **`DashboardViewport`** — `CaChartPanel` stays permanently mounted; only its visibility is toggled via a `hidden` CSS class. Eliminated the full page-state teardown (and the perceived page reload) when switching tabs.

### Bug Fixes

- Fixed `Cannot redeclare block-scoped variable 'mintLoadedRef'` — duplicate `useRef` in `CaChartPanel`.
- Fixed `Property 'queryPermission' does not exist on type 'FileSystemDirectoryHandle'` — cast to internal `PermissionableHandle` type.
- Fixed `TS6133: 'persistHandle' is declared but never read` — removed stray import from `AppContext`.
- Fixed `Property 'addCandlestickSeries' does not exist` — updated offscreen chart to `lightweight-charts` v5 API (`chart.addSeries(CandlestickSeries, ...)`).
- Coingecko CORS removed — SOL price no longer fetched from Coingecko.

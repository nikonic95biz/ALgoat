# SolClaw App-Wide Algo Trading IDE Audit

Date: 2026-05-13

Benchmark: an imaginary best-in-class Pump.fun algo-trading IDE where a user can discover tokens, design strategies with AI, backtest/replay on rich historical data, paper trade safely, promote strategies through lifecycle gates, run live with strong risk controls, and analyze every decision afterward.

## Executive Ranking

Overall score today: **4.8 / 10**

SolClaw is a strong browser-native prototype with real market data, a live order-book tape, one concrete scalper engine, paper/live execution, AI chat, local file editing, and the beginning of an Algo Lab. It is not yet a complete algo-trading IDE platform. The largest gap is that strategy creation is ahead of the runtime: users can create blueprints/presets, but the app does not yet have a generalized multi-strategy engine, strategy lifecycle, durable dataset layer, serious backtesting/replay, or production-grade safety/observability.

## Category Scores

| Area | Score | Current State | Ideal State |
| --- | ---: | --- | --- |
| Strategy authoring / Algo Lab | 4/10 | Draft blueprints, custom presets, scalper knobs | Structured strategy schema, visual rule builder, codegen, validation, lifecycle gates |
| Multi-strategy runtime | 2/10 | Registry only supports `scalper` | Pluggable strategy engines with typed inputs, outputs, risk contracts, and runners |
| Market discovery | 6/10 | Nursery scans new/bonded/older tokens and revival score | Durable discovery feed, replayable candidates, freshness/confidence scoring, strategy subscriptions |
| Chart/order-book data | 6.5/10 | Live candles, tape, PumpPortal WS, bounce zones | Historical tick/order-book store, normalized event bus, reliability metrics |
| Backtesting/replay/training | 3/10 | Scalper replay and simple sweep variants | Full event replay, walk-forward testing, parameter optimization, baselines, overfit controls |
| Paper trading | 5.5/10 | Real-time paper scalper on live feed | Strategy-agnostic simulator, latency/slippage/liquidity modeling, replay and live paper parity |
| Live trading safety | 4.5/10 | PumpPortal Lightning execution, pool fallback, stop/sell all | Preflight balances, per-position state machine, idempotency, kill hierarchy, exposure/risk caps |
| Performance/session analytics | 3.5/10 | Saved sessions with trades and config snapshot | Full decision logs, snapshots, rejected candidates, comparisons, export/import, LLM review packs |
| AI IDE/build flow | 5.5/10 | Chat/build modes, Anthropic tool loop, local writes, typecheck path | Provider-agnostic tool calling, durable build tasks, targeted rollback, test generation, safe diffs |
| Workspace/dev experience | 5/10 | Local workspace HMR, GitHub panel, Monaco | Git-aware dirty state, branch/version awareness, isolated changesets, PR/test workflow |
| Security/privacy | 4/10 | Browser-local keys, safety copy | Secret scanning, context minimization, prompt injection hardening, real-money operation gates |
| Observability/reliability | 3/10 | Stream health banner, console capture, basic errors | Full health dashboard, event logs, trace ids, diagnostics export, feed/provider timing |
| UX/product clarity | 5/10 | Clean tabs evolving, better draft guards | Task state machine, explainable readiness, guided strategy journey, no hidden side effects |

## What SolClaw Is Best At Today

1. **Fast local-first prototype loop.** File System Access + Vite HMR + in-app chat can become a powerful trading IDE workflow.
2. **Live Pump.fun surface.** Chart, tape, Nursery, and PumpPortal plumbing give the app real market awareness.
3. **One strategy is actually grounded.** The order-book scalper has a real paper state machine, configurable knobs, session logs, and live Lightning path.
4. **AI is embedded in the product, not separate.** Live app context and code editing are moving in the right direction.
5. **UI direction is improving.** Algo Lab / Trading / Performance are becoming clearer separate surfaces.

## The Ideal Pump.fun Algo IDE

An ideal system would have these layers:

1. **Discovery layer:** normalized token events from PumpPortal, pump.fun, DexScreener, RPC, wallet flows, social/metadata risk signals, and liquidity/age/bonding state.
2. **Dataset layer:** durable event store for ticks, trades, candles, watchlist changes, decisions, fills, errors, and session metadata.
3. **Strategy layer:** typed strategy interface: `discover -> watch -> signal -> size -> enter -> manage -> exit`, with declarative knobs and risk controls.
4. **Simulation layer:** replay engine with latency, slippage, fees, failed tx, liquidity, partial fills, and venue migration modeling.
5. **Training layer:** parameter sweeps, walk-forward tests, objective functions, overfit warnings, and LLM-readable experiment summaries.
6. **Runtime layer:** paper/live engines share the same signal logic, with separate executors.
7. **Safety layer:** max position, max SOL, max daily loss, kill switches, balance preflight, stale-feed guards, idempotency, and real-mode confirmations.
8. **IDE layer:** AI can inspect, edit, test, run, verify UI, roll back specific changes, and create strategy modules from blueprints.
9. **Observability layer:** event traces, feed freshness, provider status, build logs, strategy decisions, and exportable diagnostics.
10. **Promotion lifecycle:** Draft -> Implemented -> Typechecked -> Replay-passed -> Paper-ready -> Live-ready, each computed from real checks.

## Largest Missing Pieces

### 1. Strategy Platform Layer

Current evidence:
- `src/lib/strategyTypes.ts` defines `StrategyKind = "scalper"` only.
- `src/lib/strategyRegistry.ts` registers only `BUILTIN_SCALPER_STRATEGY`.
- `UserAlgoPreset.config`, `TrainingSession.configSnapshot`, and `TradingSessionRecord.configSnapshot` are scalper-shaped.

Impact:
- Zombie Sniper and future strategies can be drafted in Algo Lab, but they cannot become first-class runnable strategies without bespoke wiring.
- Performance and session logs assume scalper knobs.

Needed:
- General `StrategyDefinition<TConfig, TState, TDecision>` interface.
- Strategy registry that supports multiple engine kinds.
- Engine runner abstraction for discovery, paper, and live execution.
- Strategy-specific config schemas and UI renderers.

### 2. Durable Market/Data Layer

Current evidence:
- Nursery uses in-memory pools/maps.
- Trading sessions store closed trades and a small start snapshot.
- Performance can show session JSON, but not full event windows or rejected decisions.

Impact:
- The LLM cannot truly learn from what happened because most market context disappears.
- Training data is not reproducible or replayable across reloads.

Needed:
- IndexedDB or file-backed event store.
- Strategy decision log: candidates, skipped reasons, entries, exits, errors.
- Order-book/tape snapshots around signals and fills.
- Export/import/replay session artifacts.

### 3. Backtesting And Replay

Current evidence:
- `strategyReplay.ts` replays only the built-in scalper over current tape rows.
- `strategyTraining.ts` runs a few hardcoded scalper variants.

Impact:
- Users cannot validate a new algorithm before paper/live.
- There is no walk-forward testing or historical replay for Zombie/Discovery strategies.

Needed:
- Replay engine over saved event data.
- Parameter grid/sweeps by strategy schema.
- Baselines: no-trade, buy-and-hold, current scalper.
- Overfitting warnings and sample-size confidence.

### 4. Strategy Lifecycle Gates

Current evidence:
- `AlgoBlueprint.status` exists, but status/runnable are mostly stored fields.
- Trading now blocks non-runnable drafts, but readiness is not computed from checks.

Impact:
- Users can see a blueprint, but the product cannot confidently say what stage it is in.

Needed:
- Computed lifecycle gates:
  - Draft has required fields.
  - Implemented source files exist.
  - Typecheck/build passed.
  - Replay passed minimum criteria.
  - Paper session completed.
  - Live safety checklist passed.

### 5. Live Trading Safety And Execution State

Current evidence:
- Real trading has good early safeguards: confirmed buy before sell, venue fallback, manual sell, halt state.
- But state is component/ref-based in `CaChartPanel.tsx`, not a durable execution engine.

Impact:
- A reload, tab sleep, or edge-case tx state can make live trading hard to audit.

Needed:
- Durable execution intents before sending tx.
- Position state machine persisted per session.
- Balance preflight, max exposure, max daily loss, one-position locks.
- Idempotency keys / processed event ids.
- Stale-feed and hidden-tab protection.

### 6. AI Build System Maturity

Current evidence:
- Anthropic has tool loop; OpenAI-compatible models are chat-only for autonomous builds.
- Tool state is improving, but no durable build task/checklist exists yet.
- Rollback is still coarse compared to ideal targeted response rollback.

Impact:
- The IDE can feel magical when it works, but brittle on long multi-file builds.

Needed:
- Provider capability registry.
- Durable build task object: goal, plan, files touched, tool results, verification status.
- Targeted rollback by response/edit id.
- Test generation and execution.
- File version/dirty checks before writes.

### 7. Observability And Diagnostics

Current evidence:
- Browser verifier reports snapshots/console to local agent.
- Stream health and live errors are shown in some places.

Impact:
- Users cannot easily tell whether a failure is model, workspace, feed, strategy, provider, or wallet.

Needed:
- Health dashboard for: model, local agent, workspace, PumpPortal WS, DexScreener, RPC, wallet, strategy engine.
- Trace ids for build/trading sessions.
- Exportable redacted diagnostic bundle.

## Product Ranking Versus Ideal

### Current Level: "Promising Alpha / Prototype IDE"

SolClaw is beyond a mockup. It has real live data, a real scalper loop, real Lightning trades, an AI assistant, and local code writes. But it is still before the platform stage where any user-defined algo can be designed, tested, promoted, run, and improved in a trustworthy loop.

### Best Description

**A live Pump.fun trading workstation with one real strategy and an emerging AI IDE, not yet a generalized algo-trading IDE.**

## Top 12 Missing Capabilities

1. **Multi-strategy engine SDK** for scalper, zombie, bonding, migration, wallet-copy, volume-breakout, etc.
2. **Strategy lifecycle gates** from draft to live-ready.
3. **Durable event/session store** with replayable market data.
4. **Backtesting/replay engine** across saved token histories.
5. **Decision logs** including skipped candidates and rejected trades.
6. **Strategy-agnostic Performance tab** with comparisons and LLM review packs.
7. **Real-money risk manager** with exposure/loss/session limits.
8. **Provider/tool capability registry** for the AI IDE.
9. **Durable build task + targeted rollback** for chat edits.
10. **Feed/agent/wallet health dashboard** with exact blockers.
11. **Security guardrails** for secrets, prompt injection, and live trading.
12. **Regression tests/e2e flows** for Chat -> Algo Lab -> Trading -> Performance.

## Recommended Build Roadmap

### Phase 1: Make The Platform Honest

Goal: eliminate draft/runtime confusion and make readiness explicit.

- Add a `StrategyRuntimeDefinition` interface.
- Convert scalper into the first runtime plugin.
- Make all non-runtime presets show as Algo Lab drafts only.
- Add computed readiness: `draft`, `implemented`, `verified`, `paper-ready`, `live-ready`.
- Update Trading and Performance to key off runtime capability, not just preset existence.

### Phase 2: Generalize Data And Sessions

Goal: make every session useful for AI iteration.

- Replace scalper-shaped `configSnapshot` with strategy-specific config payloads.
- Add event/decision logs to session records.
- Store entry/exit tape windows and rejected candidates.
- Add JSON export/import and replay seed.

### Phase 3: Add Replay/Backtest

Goal: before live/paper, every algo can run against saved data.

- Create generic replay runner.
- Add built-in baselines.
- Add parameter sweep from strategy knob schema.
- Show sample size, drawdown, win rate, PnL, missed entries, and confidence.

### Phase 4: Build Zombie Sniper As First Non-Scalper Strategy

Goal: prove the platform supports a different strategy class.

- Use Nursery as discovery feed.
- Maintain a watchlist with silence threshold, max age, liquidity, MC floor.
- Trigger entry on first qualifying buy after silence.
- Add max positions and kill switch.
- Log every candidate and rejected reason.

### Phase 5: Harden AI IDE

Goal: make chat feel like a real coding agent, not a fragile helper.

- Build task state machine.
- Provider capability matrix.
- Targeted rollback.
- Dirty file/version checks.
- Verification summary per response.
- Test generation for strategy modules.

### Phase 6: Production Safety

Goal: real trading needs professional controls.

- Risk manager: max SOL per position, max positions, max daily loss, session timeout.
- Durable tx intent log.
- Idempotency for buy/sell events.
- Wallet balance preflight.
- Feed stale/hidden-tab stop guards.
- Redacted diagnostics export.

## Final Scorecard

If the ideal Pump.fun algo IDE is **10/10**, SolClaw is:

- **As a live trading/chart workstation:** 6.5/10
- **As a one-strategy scalper bot:** 6/10
- **As an AI coding surface:** 5.5/10
- **As a generalized algo IDE:** 3/10
- **As a safe live-trading platform:** 4/10
- **Overall:** **4.8/10**

The main opportunity is not adding more UI. It is building the missing platform spine: strategy runtime, durable data, replay, lifecycle gates, and risk controls.

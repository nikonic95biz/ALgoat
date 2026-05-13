# SolClaw

**An open-source, browser-native algo-trading IDE for Solana memecoins.**

---

## What is SolClaw?

SolClaw is a tool for people who want to build and run their own trading strategies on Pump.fun — without trusting a platform, signing up for an account, or handing over their keys.

Everything runs in the browser. There is no backend. You bring your own API keys (LLM, PumpPortal, wallet) and the app uses them directly — nothing passes through any SolClaw server. The full source is here to read and verify.

The core idea is that strategy creation and execution should happen in the same place. You describe what you want in the AI chat, the assistant reads your live trading state, proposes code or config changes, and applies them directly to your local repo. Paper-test first, go live when ready.

Current state: one concrete strategy (order-book scalper), live Pump.fun data, paper and real execution, a discovery feed (Nursery), and the foundational wiring for a multi-strategy IDE. More strategies, deeper backtesting, and a full strategy lifecycle are on the roadmap.

---

## Features

- **Live chart** — Pump.fun candles (1 s → 15 m), viewport-triggered lazy loading, auto-refresh
- **Order-book tape** — Real-time PumpPortal WebSocket stream of buys and sells for any token
- **Algo engine** — Built-in order-book scalper (paper + real). Arms on dip + bounce-zone alignment, enters on catalyst buy, exits on take-profit or sell-pressure stop
- **Bounce zones** — Algo-detected support levels fire automatically on chart load; LLM vision analysis is manual-triggered (BETA)
- **Nursery** — Continuous discovery feed: new launches, graduation candidates, recently bonded tokens, older revival candidates
- **AI assistant** — Chat with any LLM (Anthropic, OpenAI, Groq, OpenRouter, xAI, Mistral, DeepSeek, Gemini, Ollama). The assistant sees live trading state and can propose or apply code changes
- **In-browser IDE** — Monaco editor + file tree. Connect a local repo folder and AI edits write directly to disk via Vite HMR
- **Algo Lab** — Blueprint and preset system for designing and iterating on strategies
- **Performance history** — Unified real + paper trade log with ROI, entry/exit levels, timestamps, and Solscan links

---

## Privacy

SolClaw is fully open source — [read the code](https://github.com/Enrichfun/solclaw). All keys and secrets are stored only in your browser's `localStorage`. Nothing is sent to any SolClaw-owned server. Your keys go directly to the provider you configured (Anthropic, PumpPortal, Solana RPC, etc.) — straight from your browser.

---

## Architecture

```
Browser only — no server required
───────────────────────────────────────────
PumpPortal WS  →  live tape + order book
Pump.fun REST  →  candles (proxied in dev)
DexScreener    →  nursery bonded feed
Solana RPC     →  wallet balance, token supply
LLM providers  →  chat, code edits, vision analysis
GitHub REST    →  read/write/fork repo files
File System API→  local repo edits (instant HMR)
```

State lives in `localStorage` + IndexedDB. No accounts, no sync, no tracking.

---

## Stack

| Layer | Library |
|---|---|
| UI | React 19, Tailwind 4, Vite 6 |
| Charts | `lightweight-charts` v5 |
| Editor | Monaco (via `@monaco-editor/react`) |
| Solana | `@solana/web3.js` |
| LLM | Anthropic, OpenAI-compatible (any provider) |

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/Enrichfun/solclaw
cd solclaw
npm install
```

### 2. Start the dev server

```bash
npm run dev
```

Vite starts on port 5173 by default. The `predev` script runs `scripts/bundle-workspace.mjs` first, which snapshots the repo into `public/bundled-workspace/` so the in-browser IDE can read source files without a GitHub token.

### 3. Configure (in-app)

Open the **Setup** panel (gear icon, top right). Everything is optional — use only what you need:

| Setting | What it unlocks |
|---|---|
| **LLM API key** *(optional)* | AI chat and code edits. Paste any key — provider is detected automatically. Supports Anthropic, OpenAI, Groq, xAI, Mistral, DeepSeek, Gemini, OpenRouter, Ollama |
| **PumpPortal API key** *(optional)* | Live order book and real trade execution. Without it the app runs in read-only / paper mode. Get one at [pumpportal.fun](https://pumpportal.fun) |
| **Trading wallet** *(optional)* | Solana private key for real-money execution. Only needed for live trades |
| **GitHub PAT + repo** *(optional)* | Lets the AI push code edits to your fork |
| **Local workspace** *(optional)* | Connect your cloned repo folder so AI edits write directly to disk (instant Vite HMR) |

---

## Trading modes

### Paper
No real money. Same engine, tape, and bounce zones as live. PnL shown as market-cap % move with an optional SOL estimate.

### Real
Requires a PumpPortal API key and a funded trading wallet. Buys and sells via **PumpPortal Lightning** with automatic pool fallback (bonding curve → PumpSwap). SOL PnL is read from Solana RPC after each trade.

---

## AI assistant

The chat panel sends the LLM your live trading state (mint, mode, algo, scalper snapshot, bounce zones) and, if a workspace is connected, relevant source files. The model responds with structured output that the app can act on:

| Block | Effect |
|---|---|
| ` ```typescript:src/path/file.ts ``` ` | Auto-applied to disk in build mode |
| ` ```config ``` ` | Live knob update — no redeploy needed |
| ` ```algo ``` ` | Adds a new preset to Algo Lab |

**Build mode** uses a strict single-pass pipeline — no open-ended tool loops:
1. Deterministic file prefetch (`list_files` → `search_code` → `read_file`)
2. Single LLM call with all context in one shot
3. Response validated against a build artifact schema
4. Valid edits auto-applied to disk; truncated or unsafe responses are blocked

---

## Algo Lab

| Concept | Description |
|---|---|
| **Blueprint** | Goal, signals, entry/exit/risk rules, and knob definitions for a strategy |
| **Preset** | A named snapshot of knob values for a blueprint |
| **Paper test** | Run any preset against the live tape without real money |
| **Performance** | Closed trade history, win rate, PnL |

Built-in strategy: **order-book scalper**. Add new strategies in `src/lib/strategyRegistry.ts`.

---

## Discovery (Nursery)

Four live feeds of Pump.fun tokens:

| Feed | What it shows |
|---|---|
| New launches | All pre-bond pairs, newest first |
| Graduating | Pre-bond tokens sorted by bonding-curve progress |
| Recently bonded | Tokens that graduated to PumpSwap in the last 2 days |
| Older revivals | Graduated tokens 2–30 days old, sorted by revival score |

Each token flows into a `DiscoveryBus` backed by IndexedDB. Clicking any token opens its chart.

---

## Deploy

```bash
npm run build
# output → dist/
```

`dist/` is fully static — deploy it to any host. No server needed.

For production CORS, add proxy rewrites for:
- `/pump-api/*` → `https://swap-api.pump.fun/*`
- `/pump-frontend/*` → `https://frontend-api.pump.fun/*`

`vercel.json` in the repo has a working example.

---

## Contributing

### Dev LLM proxy

In dev, `vite.config.ts` proxies all LLM provider requests under `/__proxy/llm/*` so `Authorization` headers reach providers without CORS issues. On deployed builds, requests go directly from the browser.

### Adding a strategy

1. Implement `StrategyRuntime` and define a `StrategyRuntimeDefinition` in `src/lib/`
2. Register both in `STRATEGY_REGISTRY` and `STRATEGY_RUNTIME_REGISTRY` in `src/lib/strategyRegistry.ts`
3. Wire the new strategy into `DashboardSidebar` and `AlgoTabs`

---

## License

MIT — see `LICENSE`.

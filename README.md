# SolClaw

**An open-source, browser-native algo-trading IDE for Solana memecoins.**

SolClaw is a fully client-side trading workstation. No backend, no accounts, no custody. API keys, wallet secrets, and code never leave the browser. Everything runs locally — charting, live order-book analysis, algo execution, and an AI assistant that can read live app state and write code directly into the repo.

---

## Features

- **Live chart** — Pump.fun candles (1 s → 15 m), viewport-triggered lazy loading, auto-refresh via `lightweight-charts` v5
- **Order-book tape** — Real-time PumpPortal WebSocket stream of buys and sells for any token
- **Algo engine** — Built-in order-book scalper (paper and real). Arms on dip + bounce-zone alignment, enters on catalyst buy, exits on take-profit or sell-pressure stop
- **Vision bounce zones** — Algo-detected support levels fire automatically on chart load; LLM vision analysis is manual-triggered (BETA)
- **Nursery** — Continuous discovery feed: new Pump.fun launches, graduation candidates, recently bonded tokens, zombie revival candidates
- **AI assistant** — Chat with any LLM (Anthropic, OpenAI, Groq, OpenRouter, xAI, Mistral, DeepSeek, Gemini, Ollama). The assistant sees live trading state and can propose or apply code changes
- **In-browser IDE** — Monaco editor + file tree. Connect a local repo folder (File System Access API) and the AI writes code directly to disk; Vite HMR picks it up instantly
- **Algo Lab** — Blueprint and preset system for designing, naming, and iterating on strategies
- **Performance history** — Unified real + paper trade log with ROI, entry/exit levels, timestamps, and Solscan links

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

Vite starts on port 5173 by default. The `predev` script runs `scripts/bundle-workspace.mjs` first, which snapshots the repo into `public/bundled-workspace/` so the in-browser IDE can browse source files without a GitHub token.

### 3. Configure (in-app)

Open the **Setup** panel (gear icon, top right):

| Setting | Status | Notes |
|---|---|---|
| **LLM API key** | Optional | Enables AI chat and code edits. Paste any key — provider is detected automatically. Supported: Anthropic, OpenAI, Groq, xAI, Mistral, DeepSeek, Gemini, OpenRouter, Ollama |
| **PumpPortal API key** | Optional | Enables live order book and real trade execution. Get one at [pumpportal.fun](https://pumpportal.fun). Without it, the app still works in read-only / paper mode |
| **Trading wallet** | Optional | Solana private key for real-money execution. Only needed if you want live trades |
| **GitHub PAT + repo** | Optional | Only needed if you want the AI to push code edits to a GitHub fork |
| **Local workspace** | Optional | Connect your cloned repo folder so AI edits write directly to disk (instant Vite HMR) |

> **Privacy:** SolClaw is fully open source — [audit the code yourself](https://github.com/Enrichfun/solclaw). All keys and secrets are stored only in your browser's `localStorage`. Nothing is sent to any SolClaw-owned server. Your keys go only to the provider you configured (Anthropic, PumpPortal, etc.), directly from your browser.

---

## Trading modes

### Paper
No real money. Same engine, tape, and bounce zones as live. PnL shown as market-cap % move with an optional SOL estimate.

### Real
Requires a PumpPortal API key and a funded trading wallet. Buys and sells via **PumpPortal Lightning** with automatic pool fallback (bonding curve → PumpSwap). SOL PnL is read from Solana RPC after each trade.

---

## AI assistant

The chat panel is a full-context LLM interface that receives live trading state (mint, mode, algo, scalper snapshot, bounce zones) and, if a workspace is connected, open file content.

The model can respond with structured blocks:

| Block type | Effect |
|---|---|
| ` ```typescript:src/path/file.ts ``` ` | Auto-applied to disk in build mode |
| ` ```config ``` ` | Live knob update — no redeploy needed |
| ` ```algo ``` ` | Adds a new preset to Algo Lab |

### Build mode

Build mode uses a strict single-pass pipeline — no open-ended tool loops that can exhaust token budgets:

1. Deterministic prefetch of relevant files (`list_files` → `search_code` → `read_file`)
2. Single LLM call with all context in one shot
3. Response validated against a build artifact schema
4. Valid edits auto-applied to disk; truncated or leaky responses are blocked

The build flow is state-machine driven: `chat → build_running → build_verifying → build_done / build_failed`.

---

## Algo Lab

| Concept | What it is |
|---|---|
| **Blueprint** | Goal, signals, entry/exit/risk rules, and knob definitions for a strategy |
| **Preset** | A named snapshot of knob values for a given strategy |
| **Paper test** | Run any preset against the live tape without real money |
| **Performance tab** | Closed trade history, win rate, PnL |

The only built-in strategy is the **order-book scalper**. New strategies can be registered in `src/lib/strategyRegistry.ts`.

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

Deploy `dist/` to any static host. No server needed.

To avoid CORS issues in production, add proxy rewrites for:
- `/pump-api/*` → `https://swap-api.pump.fun/*`
- `/pump-frontend/*` → `https://frontend-api.pump.fun/*`

`vercel.json` in the repo has a working example of these rewrites.

---

## Contributing

### LLM proxy (dev only)

In dev, `vite.config.ts` proxies all LLM provider requests under `/__proxy/llm/*` so `Authorization` headers work without CORS issues. On deployed builds, requests go directly from the browser.

### Adding a strategy

1. Implement `StrategyRuntime` and define a `StrategyRuntimeDefinition` in `src/lib/`
2. Register both in `STRATEGY_REGISTRY` and `STRATEGY_RUNTIME_REGISTRY` in `src/lib/strategyRegistry.ts`
3. Wire the new strategy into `DashboardSidebar` and `AlgoTabs`

---

## License

MIT — see `LICENSE`.

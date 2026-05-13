# SolClaw

**An open-source, browser-native algo-trading IDE for Solana memecoins.**

SolClaw is a fully client-side trading workstation. No backend, no custody, no accounts. Your keys, wallet secrets, and code never leave your browser. Everything runs on your machine — charting, order-book analysis, algo execution, and an AI assistant that can read live app state and write code directly into your local repo.

---

## What it does

- **Live chart** — Pump.fun candles (1 s → 15 m) with viewport-triggered lazy loading and auto-refresh. Rendered with `lightweight-charts` v5.
- **Order-book tape** — Real-time PumpPortal WebSocket stream of buys and sells for any token.
- **Algo engine** — Built-in order-book scalper (paper and real). Arms on dip + bounce-zone alignment, enters on catalyst buy, exits on take-profit or sell-pressure stop.
- **Vision bounce zones** — Algo-detected support levels auto-fire on load. AI (LLM vision) analysis is manual-triggered and BETA.
- **Nursery** — Continuous discovery feed: new Pump.fun launches, graduation candidates, recently bonded tokens, zombie revival candidates.
- **AI assistant** — Chat with any LLM (Anthropic, OpenAI, Groq, OpenRouter, xAI, Mistral, DeepSeek, Gemini, Ollama). The assistant sees your live trading state and can propose or apply code changes.
- **In-browser IDE** — Monaco editor + file tree. Connect your local repo folder (File System Access API) and the AI writes code directly to disk. Vite HMR picks it up instantly.
- **Strategy lab** — Blueprint and preset system for designing, naming, and evolving trading strategies. Paper-test before going live.
- **Performance history** — Unified real + paper trade log with ROI, entry/exit levels, timestamps, and Solscan links.

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

State: `localStorage` + IndexedDB. No accounts, no sync, no tracking.

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
git clone https://github.com/solclaw/solclaw
cd solclaw
npm install
```

### 2. Run locally

```bash
npm run dev
```

`predev` runs `scripts/bundle-workspace.mjs` first, which snapshots your repo into `public/bundled-workspace/` so the in-browser IDE can read files without a GitHub token.

Open [http://localhost:5173](http://localhost:5173).

### 3. Setup (in-app)

Open the **⚙ Setup** panel (top-right gear icon) and configure:

| Step | What to add |
|---|---|
| **LLM** | Paste any API key — provider is detected automatically from the key shape |
| **PumpPortal** | API key from [pumpportal.fun](https://pumpportal.fun) (optional, enables real trading) |
| **Trading wallet** | Solana private key for real-money execution (stays in browser only) |
| **GitHub** | PAT + owner/repo for pushing AI code edits to a fork |
| **Local workspace** | Connect your local SolClaw repo folder for instant disk writes |

---

## Trading modes

### Paper trading
No real money. Uses the same scalper engine, tape, and bounce zones as real mode. PnL shown as market-cap % move and optional SOL estimate.

### Real trading
Requires PumpPortal API key + trading wallet. Buys and sells via **PumpPortal Lightning** with automatic pool fallback (bonding curve → Raydium). SOL PnL parsed from Solana RPC.

---

## AI assistant (chat)

The chat panel is a full-context LLM interface. It receives:
- Live trading state (mint, mode, algo, scalper snapshot, bounce zones)
- Open file content (if workspace connected)
- Strategy blueprints and preset knobs

It can respond with:
- ```` ```typescript:src/path/file.ts ```` blocks → auto-applied to disk in build mode
- ```` ```config ```` blocks → live knob updates (no redeploy)
- ```` ```algo ```` blocks → adds a new preset to Algo Lab
- Follow-up suggestions, blueprint drafts, and trading analysis

### Build mode
When building, the assistant operates in a strict single-pass pipeline:
1. Deterministic prefetch of relevant files (list, search, read up to 3 files)
2. Single LLM call — no open-ended tool loops
3. Response is validated against a build artifact schema
4. Valid file edits auto-apply to disk; invalid/truncated responses are blocked

Build flow is managed by an explicit state machine: `chat → build_running → build_verifying → build_done / build_failed`.

---

## Algo Lab

Design, parameterise, and iterate on trading strategies:
- **Blueprint** — goal, market, signals, entry/exit/risk rules, knobs
- **Preset** — named config snapshot (knobs) for a strategy
- **Paper test** — run any preset against live tape in paper mode
- **Performance tab** — review closed trades, win rate, PnL

Built-in strategy: **Order-book scalper**. Register new strategies in `src/lib/strategyRegistry.ts`.

---

## Discovery (Nursery)

Four real-time feeds of Pump.fun tokens:
- **New launches** — all pre-bond pairs, newest first
- **Graduating** — pre-bond tokens sorted by bonding-curve progress
- **Recently bonded** — tokens that just graduated to Raydium (< 2 days)
- **Older revivals** — graduated tokens 2–30 days old sorted by revival score

Each token flows into `DiscoveryBus` (IndexedDB-backed) with tier scoring. Clicking any token opens its chart. The discovery bus is wired for multi-mint strategy subscriptions — groundwork for auto-discovery algo execution.

---

## Deploy

```bash
npm run build
```

Output: `dist/`. Deploy to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages, etc.).

- Build command: `npm run build`
- Output directory: `dist`
- No server required — fully static

If your host supports rewrite rules, proxy `/pump-api/*` → `https://swap-api.pump.fun/*` and `/pump-frontend/*` → `https://frontend-api.pump.fun/*` to avoid CORS issues in production. See `vercel.json` for a working example.

---

## Development notes

### LLM proxy
In dev, `vite.config.ts` proxies all provider endpoints under `/__proxy/llm/*` so `Authorization` headers reach providers without CORS issues. On deployed builds, requests go directly from the browser — configure CORS in your provider dashboard or use OpenRouter as a proxy.

### Adding a strategy
1. Add a `StrategyRuntimeDefinition` and `StrategyRuntime` implementation in `src/lib/`
2. Register it in `STRATEGY_REGISTRY` and `STRATEGY_RUNTIME_REGISTRY` in `src/lib/strategyRegistry.ts`
3. Wire it in `DashboardSidebar` and `AlgoTabs` alongside the built-in scalper

---

## License

MIT — see `LICENSE`.

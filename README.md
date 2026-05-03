# SolClaw

**The algo trading IDE for Solana memecoins.**

Live chart, order-book tape, token Nursery, paper trading sim, real PumpPortal Lightning execution, and an AI assistant that sees your live dashboard — all in one browser tab. No backend, no signup, keys stay local.

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## What it does

| Feature | Details |
|---------|---------|
| **Chart** | Live OHLC for any pump.fun mint, auto-streaming via PumpPortal WebSocket |
| **Order-book tape** | Real-time buy/sell print stream with size and market cap |
| **Nursery** | Four-tab token watcher — New Launches, Not So New, A Little Old, Older (zombie revival scoring) |
| **Scalper bot** | Rules-based algo on the live tape — dip entry, take-profit, stop-loss. Paper by default, flip to live when ready |
| **Real trading** | PumpPortal Lightning API — executes directly from the wallet linked to your API key |
| **AI assistant** | Embedded chat (Anthropic, OpenAI, Groq, OpenRouter, Mistral, Ollama, …) with full codebase + live dashboard context |
| **In-browser IDE** | Monaco editor with a bundled project snapshot — browse and edit algos without leaving the tab |
| **GitHub integration** | Optional PAT → fork, live file tree, commit and push from inside the IDE |

All state (keys, settings, chat history) lives in **your browser's `localStorage`**. Nothing is sent to any server this project operates.

---

## Run locally

```bash
git clone https://github.com/<your-username>/solclaw.git
cd solclaw
npm install
npm run dev
```

Open **`http://localhost:5173`** — landing page at `/`, IDE at `/app`.

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server + local proxies for LLM / pump.fun APIs |
| `npm run build` | Production build → `dist/` (bundled workspace regenerated automatically) |
| `npm run preview` | Preview the production build locally |

---

## First-time setup

Open **Setup** (key icon in the nav) and add:

1. **PumpPortal API key** — [pumpportal.fun/trading-api/setup](https://pumpportal.fun/trading-api/setup). Keep ≥ 0.02 SOL in the linked wallet for the order book and real trades to work.
2. **LLM key** — any supported provider. The app auto-detects from the key prefix (`sk-ant-` → Anthropic, `sk-or-v1-` → OpenRouter, `gsk_` → Groq, etc.).
3. **GitHub PAT** *(optional)* — `public_repo` scope. Enables live file tree and commit-from-IDE.

---

## Deploy to Vercel

This repo ships a `vercel.json` configured for the `/solclaw` base path (matching [enrich.fun/solclaw](https://enrich.fun/solclaw)).

1. Import `enrichthetrenches/solclaw` at [vercel.com/new](https://vercel.com/new).
2. Vercel picks up `vercel.json` automatically — build command, output dir, and env vars are pre-configured.
3. Add your domain under **Settings → Domains**.

### Deploying on your own domain at root (`/`)

Remove the `env` block and `redirects` from `vercel.json`, then add a single catch-all rewrite:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Build will output to `dist/` and the site runs at your domain root.

### GitHub Pages / Netlify / Cloudflare Pages

Set `VITE_BASE_PATH` to your repo or sub-path name at build time:

```bash
VITE_BASE_PATH=solclaw npm run build   # outputs to dist/solclaw/
```

Add your host's SPA fallback to serve `index.html` for all routes under that path.

---

## Environment variables

Copy `.env.example` → `.env.local` (never commit `.env.local`). All optional — paste keys inside the app instead.

| Variable | Purpose |
|----------|---------|
| `VITE_BASE_PATH` | Sub-path prefix (e.g. `solclaw`). Leave empty to deploy at `/`. |
| `VITE_PUMPPORTAL_API_KEY` | Default PumpPortal key (in-app Setup overrides). |
| `VITE_SOLANA_RPC_URL` | Custom RPC for balance / supply helpers. |
| `VITE_GITHUB_UPSTREAM_OWNER` | Upstream GitHub owner for Setup → Fork & connect. |
| `VITE_GITHUB_UPSTREAM_REPO` | Upstream repo name (pair with owner above). |
| `VITE_GITHUB_REPO_URL` | Full URL shown as the "View source" link on the landing page. |
| `VITE_DISABLE_LLM_PROXY` | Set `1` to call LLM APIs directly (skips localhost proxy). |
| `VITE_CHAT_SIMULATE` | Set `true` for fake streaming — UI testing, no API calls. |

---

## LLM providers supported

| Provider | Key prefix | Notes |
|----------|-----------|-------|
| Anthropic | `sk-ant-…` | Claude 3.5 / 3 Sonnet, Haiku, Opus |
| OpenAI | `sk-proj-…` / `sk-svcacct-…` | GPT-4o, o1, etc. |
| Groq | `gsk_…` | Fast inference, Llama / Mixtral |
| OpenRouter | `sk-or-v1-…` | 200+ models behind one key |
| Mistral | — | mistral-large, codestral |
| DeepSeek | — | deepseek-chat / reasoner |
| xAI (Grok) | — | |
| Google AI Studio | `AIza…` | Gemini 1.5 / 2.0 |
| Together AI | — | Open-source model hosting |
| Perplexity | — | |
| Ollama (local) | No key | Point to `http://localhost:11434` |

---

## Architecture

```
src/
├── components/
│   ├── LandingPage.tsx         # Marketing page (/)
│   ├── TradingWorkspace.tsx    # IDE shell (/app)
│   ├── AppTopChrome.tsx        # Horizontal nav + setup progress chip
│   ├── DashboardSidebar.tsx    # Scalper controls + live entry size
│   ├── DashboardViewport.tsx   # Chart tab + Nursery tab
│   ├── CaChartPanel.tsx        # OHLC chart + paper scalper trigger
│   ├── NurseryPanel.tsx        # Four-tab token watcher UI
│   ├── PumpOrderBook.tsx       # Live buy/sell tape
│   ├── ChatPanel.tsx           # AI assistant UI (SSE, diff/Apply)
│   ├── SetupPanel.tsx          # Keys, wallet, LLM config
│   ├── WorkspacePanel.tsx      # Monaco IDE + GitHub file ops
│   └── Tooltip.tsx             # Portal-rendered hover tooltips
├── context/
│   └── AppContext.tsx          # All global state (localStorage-backed)
├── lib/
│   ├── nurseryEngine.ts        # Token watcher — PumpPortal WS + pump.fun REST + DexScreener
│   ├── pumpPortalRealtime.ts   # Shared WebSocket to PumpPortal
│   ├── scalperPaperEngine.ts   # Paper trading rules engine
│   ├── pumpPortalLightningTrade.ts  # Real trade execution
│   ├── streamAnthropic.ts      # Anthropic SSE streaming
│   ├── buildChatContext.ts     # Live dashboard state → LLM context
│   ├── githubApi.ts            # GitHub REST helpers
│   ├── llmBackends.ts          # Provider configs + key inference
│   └── siteUrls.ts             # Base path + route helpers
└── types.ts
```

Contributor and IDE-agent guide: **[AGENTS.md](./AGENTS.md)**

---

## Security & privacy

- **All keys stay in your browser.** PumpPortal key, LLM key, GitHub PAT, and wallet data are stored in `localStorage` only — never sent to any server this project operates.
- **Trading wallet private key** (optional, for Lightning trades) is browser-only. Use a dedicated low-balance signer wallet — never your main wallet.
- **Do not commit `.env.local`** — `.gitignore` blocks it automatically.
- **No telemetry.** Open the network tab and verify.

---

## Contributing

PRs and issues welcome.

```bash
npm run build   # must pass with zero errors (includes tsc --noEmit)
```

If you move or rename files, update `src/lib/projectKnowledge.ts` so the in-app assistant stays accurate. Full contributor workflow in **[AGENTS.md](./AGENTS.md)**.

---

## License

[MIT](./LICENSE) — free to fork, modify, and deploy.

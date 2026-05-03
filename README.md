# Unknown Name Trader

**Open-source browser-based trading workspace** for Pump.fun / Solana tokens.

Live OHLC chart, order-book prints, paper scalper sim, multi-provider LLM chat assistant, and an **in-browser IDE**: browse and edit this repo from a **bundled snapshot** shipped with every build (no GitHub account). Optional GitHub PAT unlocks **live repo + push commits** to your fork — no backend required.

> **Paper trading only.** Real on-chain execution is not wired in this release. Always trade with money you can afford to lose.

---

## Table of contents

- [What it does](#what-it-does)
- [Self-host in 60 seconds](#self-host-in-60-seconds)
- [Run locally](#run-locally)
- [First-time setup (inside the app)](#first-time-setup-inside-the-app)
- [In-browser IDE (bundled + optional GitHub)](#in-browser-ide-bundled--optional-github)
- [Environment variables](#environment-variables)
- [Deploying to Vercel / Netlify / Cloudflare Pages](#deploying-to-vercel--netlify--cloudflare-pages)
- [GitHub Pages](#github-pages)
- [LLM providers supported](#llm-providers-supported)
- [Architecture](#architecture)
- [Security & privacy](#security--privacy)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

| Feature | Details |
|---------|---------|
| **Chart** | OHLC price chart for any Pump.fun mint, auto-streaming via PumpPortal |
| **Order book / tape** | Live buy/sell print stream (`subscribeTokenTrade`) |
| **Paper scalper** | Rules-based simulation running on the live tape — dip entry, TP/stop logic, bot trade history |
| **Algo assistant** | Embedded chat (OpenAI, Anthropic, Groq, OpenRouter, Mistral, Ollama, …) with bundled codebase context |
| **Wallets** | Local wallet store — public + optional private key, stored in your browser only |
| **Code / IDE** | **Bundled snapshot** of this repo (Monaco) — works offline after load; edits saved in the browser. Optional **GitHub** mode + PAT to push commits |

All state (keys, settings, chat history) lives in **your browser's `localStorage`**. Nothing is sent to any server controlled by this project.

---

## Self-host in 60 seconds

The fastest path for someone who just wants to use it:

1. **Fork** this repo on GitHub (top-right **Fork** button).
2. Go to your fork → **Settings → Pages → Build and deployment** → set Source to **GitHub Actions** (or use the Vercel/Netlify buttons below).
3. Add a simple build workflow (see [GitHub Pages](#github-pages) section) or deploy via [Vercel](#deploying-to-vercel--netlify--cloudflare-pages).
4. Visit your live URL, open **Setup** (key icon), paste your keys, trade.

---

## Run locally

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
npm run dev
```

Open **`http://localhost:5173`** in your browser.

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server with local proxies for LLM + GitHub + Pump candles; **workspace bundle runs first** so the Code sidebar works without GitHub |
| `npm run build` | Production build → `dist/` (**bundled workspace** regenerated automatically) |
| `npm run preview` | Preview the production build locally (proxy still active on localhost) |

> **No `.env` file required to start.** Paste keys inside the app instead.

---

## First-time setup (inside the app)

Click the **key icon** in the left activity bar to open **Setup**.

### 1 — PumpPortal (order book & tape)

Paste your [PumpPortal API key](https://pumpportal.fun/trading-api/setup).  
PumpPortal gives you a wallet — keep **≥ 0.02 SOL** there or the order book will show nothing.

### 2 — LLM / Algo assistant

Paste your API key from any supported provider.  
The app auto-detects the provider from the key prefix (`sk-ant-` → Anthropic, `sk-or-v1-` → OpenRouter, `gsk_` → Groq, etc.).  
Pick **API provider** and **model** manually if auto-detect doesn't match.  
Running **Ollama** locally? No key needed — select Ollama from the provider list.

### 3 — GitHub (optional — push from the Code sidebar)

The **Code** icon opens the IDE using the **bundled project snapshot** by default — no credentials.

Paste **GitHub PAT**, then either tap **Fork … & connect** (creates or finds your fork of the upstream repo via the GitHub API and fills Owner / Repo / Branch) or type Owner / Repo / Branch manually — **only** if you want **GitHub** mode in that sidebar (live tree + push commits). See [below](#in-browser-ide-bundled--optional-github).

Click **Save** to persist all settings together.

---

## In-browser IDE (bundled + optional GitHub)

The **Code** icon opens a split-pane editor:

**Bundled (default)** — file tree + contents are copied into `public/bundled-workspace/` when you run `npm run dev` or `npm run build` (`scripts/bundle-workspace.mjs`). Anyone can browse and edit **without** GitHub; changes auto-save to **browser `localStorage`** (with revert-to-snapshot).

**GitHub** — switch the toggle in that panel after adding **PAT + owner + repo + branch** in Setup: live tree from the API, commit message + **Commit to GitHub** (Contents REST API).

### PAT scopes (GitHub mode only)

| Token type | Required scope |
|------------|---------------|
| Classic PAT | `repo` (private repos) or `public_repo` (public only) |
| Fine-grained PAT | **Contents: Read and write**, plus permission to **fork** repositories into your account (for **Fork & connect**) |

Upstream defaults are baked into `src/lib/githubUpstreamDefaults.ts` (override per-build with `VITE_GITHUB_UPSTREAM_OWNER` / `VITE_GITHUB_UPSTREAM_REPO`).

Tokens stay in `localStorage` on the user’s device.

---

## Environment variables

Copy `.env.example` → `.env.local` (never commit `.env.local`). All are optional — you can paste keys inside the app instead.

| Variable | Purpose |
|----------|---------|
| `VITE_PUMPPORTAL_API_KEY` | Default PumpPortal key. In-app Setup overrides this. |
| `VITE_PUMPPORTAL_WS_PUBLIC_ONLY` | Set `1` to skip appending your key to the WebSocket URL. |
| `VITE_SOLANA_RPC_URL` | Custom RPC for supply/chart helpers. |
| `VITE_DISABLE_LLM_PROXY` | Set `1` to call LLM APIs directly (may hit CORS on some providers). |
| `VITE_OPENROUTER_REFERRER` | Optional OpenRouter `HTTP-Referer` header. |
| `VITE_OPENROUTER_APP_TITLE` | Optional OpenRouter `X-Title` header. |
| `VITE_CHAT_SIMULATE` | Set `true` for gibberish streaming — UI testing only, no API calls made. |
| `VITE_GITHUB_UPSTREAM_OWNER` | Optional: canonical upstream org/user for Setup → **Fork & connect**. |
| `VITE_GITHUB_UPSTREAM_REPO` | Optional: canonical upstream repo name (pair with owner above). |

---

## Deploying to Vercel / Netlify / Cloudflare Pages

All three work out of the box with these settings:

| Setting | Value |
|---------|-------|
| Build command | `npm install && npm run build` |
| Output / publish directory | `dist` |
| Framework preset | **Vite** (auto-detected on most platforms) |

**Routes:** `/` is the marketing landing page; the full workspace loads at **`/app`**. Use your host’s SPA fallback so `/app` serves `index.html` (Vercel / Netlify / Cloudflare Pages defaults usually handle this for Vite).

**Chart candles on deployed sites:** On `localhost` the Vite dev server proxies `/pump-api` → `swap-api.pump.fun` (no CORS issues). On a deployed URL the app calls `swap-api.pump.fun` directly from the browser — this works fine on most hosts. If you hit CORS errors, add a server-side proxy on your platform and set `VITE_PUMP_API_PREFIX` in your build env vars (see `.env.example`).

**LLM / GitHub API calls on a real URL:** The local dev proxy (`/__proxy/llm/*`) only runs on `localhost`. On a deployed site the app calls providers directly from the browser. Most providers allow this; if you hit CORS, use Ollama locally or `npm run preview` as a fallback.

---

## GitHub Pages

GitHub Pages serves your site at `https://<user>.github.io/<repo>/`. Vite must know that path prefix.

**1. Set the base in `vite.config.ts`:**

```ts
export default defineConfig({
  base: "/your-repo-name/", // ← replace with your fork's exact repo name
  // ... rest of config unchanged
});
```

Commit and push this change.

**2. Add `.github/workflows/deploy.yml` to your fork:**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
        id: deployment
```

**3. In your repo → Settings → Pages**, set Source to **GitHub Actions**.

Your app will be live at `https://<user>.github.io/<repo>/` on every push to `main`.

---

## LLM providers supported

| Provider | Key prefix | Notes |
|----------|-----------|-------|
| OpenAI | `sk-proj-…` / `sk-svcacct-…` | GPT-4o, o1, etc. |
| Anthropic | `sk-ant-…` | Claude 3.5 / 3 Sonnet, Haiku, Opus |
| Groq | `gsk_…` | Fast inference, Llama / Mixtral |
| OpenRouter | `sk-or-v1-…` | 200+ models behind one key |
| Mistral | — | mistral-large, codestral, etc. |
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
│   ├── AppShell.tsx          # Root layout
│   ├── ActivityBar.tsx       # Left icon bar
│   ├── DashboardSidebar.tsx  # Sidebar switcher
│   ├── CaChartPanel.tsx      # Chart + mint input
│   ├── PumpOrderBook.tsx     # Live buy/sell tape
│   ├── ChatPanel.tsx         # LLM chat UI
│   ├── SetupPanel.tsx        # Keys + GitHub settings
│   ├── WorkspacePanel.tsx    # Bundled IDE + optional GitHub mode
│   └── ...
├── context/
│   └── AppContext.tsx        # All global state (localStorage-backed)
├── lib/
│   ├── pumpPortalRealtime.ts # WebSocket to PumpPortal
│   ├── githubApi.ts          # GitHub REST helpers (tree, get, put)
│   ├── llmDevProxy.ts        # Localhost /__proxy/llm/* routing
│   ├── llmBackends.ts        # Provider configs + key inference
│   ├── scalperPaperEngine.ts # Paper trading rules engine
│   └── projectKnowledge.ts   # Bundled context injected into the assistant
└── types.ts
```

Contributor details and IDE-agent instructions: **[AGENTS.md](./AGENTS.md)**.

---

## Security & privacy

- **All keys stay in your browser.** PumpPortal keys, LLM API keys, GitHub PATs, and wallet data are stored in `localStorage` on your device. They are never sent to any server operated by this project.
- **When you deploy your own fork**, you operate that deployment entirely — its users' keys go only to PumpPortal, their chosen LLM provider, and GitHub.
- **Do not** commit `.env.local` to git. The `.gitignore` blocks it automatically.
- **Private keys in the Wallets panel** are a convenience feature for development. In a production signing setup, use a dedicated signer that never exposes the key to a browser.
- **XSS**: treat any browser-held secret with the same care as a password — avoid untrusted extensions on tabs where you use this app.

---

## Contributing

Pull requests and issues are welcome.

Before submitting a PR:

```bash
npm run build   # must succeed with zero errors
```

If you move or rename files, update `src/lib/projectKnowledge.ts` so the in-app assistant stays accurate. Full contributor workflow in **[AGENTS.md](./AGENTS.md)**.

---

## License

[MIT](./LICENSE) — free to fork, modify, and deploy.

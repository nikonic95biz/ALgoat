/**
 * Bundled project context injected into the algo assistant's system prompt.
 * Keep this accurate when files are moved or major features are added.
 */
export function getBundledProjectKnowledge(): string {
  return `
## Product
Unknown Name Trader — open-source browser-based trading workspace for Pump.fun / Solana tokens.

Features: **Chart** (OHLC + live prints), **order book** (live buy/sell tape), **paper scalper** sim, **LLM chat** assistant with live app-state context + one-click file Apply, **Code sidebar** — Monaco editor backed by GitHub REST API; edits commit directly to the user's GitHub fork.

Deployed as a **static SPA** (Vite + React). All keys stay in the user's browser localStorage — no backend.

## Dev commands
- \`npm install\` / \`npm run dev\` → dev server at http://localhost:5173
- \`npm run build\` → production build in \`dist/\`
- \`npm run preview\` → serve \`dist/\` locally

## API proxy (localhost only)
On localhost (\`npm run dev\` or \`vite preview\`), LLM and GitHub API calls go through a same-origin proxy at \`/__proxy/llm/*\` to avoid browser CORS. On a deployed URL they hit providers directly. Use \`resolveLlmApiUrl(absoluteUrl)\` from \`lib/llmDevProxy.ts\` for any such call.

## File layout (src/)
| Area | Path | Role |
|------|------|------|
| Shell | \`App.tsx\`, \`components/AppShell.tsx\`, \`components/AppTopChrome.tsx\`, \`components/LandingPage.tsx\`, \`components/TradingWorkspace.tsx\` | \`/\` = marketing one-pager; full IDE at \`/app\` (respects \`VITE_BASE_PATH\`) |
| Global state | \`context/AppContext.tsx\` | All state (model, chat, GitHub workspace, chart analytics, …) |
| Top chrome | \`components/AppTopChrome.tsx\`, \`hooks/useSetupProgress.ts\`, \`lib/setupProgress.ts\` | Text nav (Dashboard, Setup, Code); setup progress X/4; red banner when incomplete |
| Sidebar switcher | \`components/DashboardSidebar.tsx\` | Routes \`sidebarMode\` → Dashboard, Setup, Code, **Nursery** panels |
| Nursery | \`components/NurseryPanel.tsx\`, \`lib/nurseryEngine.ts\` | Three tabs: 💀 Zombie Revival (bonded last 5 days, DexScreener revival score), 🎯 Bonding (pre-bond approaching graduation), 🔥 Pre-bond Heat. Click row → sets mint in chart. Engine is a module singleton; starts on first NurseryPanel mount. |
| Chart | \`components/CaChartPanel.tsx\` | Mint input, lightweight-charts, tape hook |
| PumpPortal WS | \`lib/pumpPortalRealtime.ts\`, \`lib/pumpPortalConfig.ts\`, \`lib/solanaWalletSecret.ts\` | WebSocket + key storage + pubkey from wallet secret |
| Order book UI | \`components/PumpOrderBook.tsx\` | Buy/sell tape |
| Candles | \`lib/pumpCandles.ts\` | REST candles + live MC merge |
| Paper scalper | \`lib/scalperPaperEngine.ts\`, \`lib/scalperPaperConfig.ts\` | Rules engine |
| Chat UI | \`components/ChatPanel.tsx\` | SSE streaming, OpenAI-compat + Anthropic; injects live app state + file content into system prompt at send time; renders Apply buttons on proposed edits |
| Chat context | \`lib/buildChatContext.ts\` | Builds live-state markdown block (mint, algo, scalper, open file + content, file tree) |
| Chat edits | \`lib/parseChatEdits.ts\` | Parses filename-annotated fenced blocks from LLM responses |
| Chat streaming | \`lib/streamChat.ts\`, \`lib/streamAnthropic.ts\` | |
| Setup | \`components/SetupPanel.tsx\`, \`lib/llmBackends.ts\`, \`lib/githubUpstreamDefaults.ts\` | PumpPortal API key + trading-wallet secret (local SOL chip); LLM; GitHub PAT; fork helper + manual Owner/Repo |
| Code workspace | \`components/WorkspacePanel.tsx\`, \`lib/githubApi.ts\` | Monaco editor; reads/commits files via GitHub REST API |
| Dev proxy | \`lib/llmDevProxy.ts\` | \`resolveLlmApiUrl()\`, proxy prefix map |
| Types | \`types.ts\` | ChatMessage, ModelSettings, GitHubWorkspaceSettings |

## Chat vs Code sidebar
- **Algo assistant (this chat):** **projectKnowledge** plus **Live app state** (injected at send time: mint, algo, scalper, open file + tree) — not arbitrary browsing of GitHub beyond that snapshot.
- **Code sidebar:** **GitHub only** — loads/commits via GitHub REST when Setup has PAT + owner/repo/branch (\`WorkspacePanel.tsx\`).

## How to help the user
1. Reference **real paths** above — never invent paths.
2. The chat receives **live app state** at send time including **chart snapshot** (last candle, MC/price mode, PumpPortal tape buffer with recent buys/sells and MC when available), plus active mint, algo, scalper status, open file path + full content, and file tree. Use it for context-aware answers — cite MC and tape stats when present.
3. When you propose a file edit, output the **entire replacement file** in a single fenced block with the filename on the opening fence (e.g. \`\`\`typescript:src/lib/scalperPaperConfig.ts). The user sees an **Apply** button that commits the change directly to their GitHub repo. Only use paths from the live file tree. External IDE users (Cursor, etc.) can also patch a local clone.
4. Prefer functional React + hooks; \`@/\` imports; Tailwind v4 utilities.
5. Never advise committing API keys — they belong in localStorage or \`.env.local\`.
6. Paper mode simulates; **real** mode uses PumpPortal Lightning from the browser (Setup keys) — be explicit about custody and third-party execution risks if asked.
7. Anthropic calls from the browser include \`anthropic-dangerous-direct-browser-access: true\` (see \`ChatPanel.tsx\`).

## Safety
Trading is risky. Paper mode exists for simulation only. No performance guarantees. Not financial advice.
`.trim();
}

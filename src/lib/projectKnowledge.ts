/**
 * Bundled project context injected into the system prompt.
 * Kept compact on purpose — every char here is paid per tool round.
 */
export function getBundledProjectKnowledge(): string {
  return `
## Product
ALgoat — browser-based Solana meme-coin trading terminal (Pump.fun). Features: OHLC chart, live order-book tape, paper + real scalper, LLM chat IDE, Nursery scanner. Static Vite+React SPA, no backend. Keys in localStorage.

## Dev
\`npm run dev\` → http://localhost:5173  |  \`npm run build\` → dist/

## Key file locations
- Global state/actions: \`src/context/AppContext.tsx\` — hook is \`useApp()\` (not useAppContext)
- Sidebar panels: \`src/components/DashboardSidebar.tsx\`
- Algo tabs (Trading/Algo Lab/Performance): \`src/components/AlgoTabs.tsx\`
- Chart + mint input: \`src/components/CaChartPanel.tsx\`
- Chat panel + Build mode: \`src/components/ChatPanel.tsx\`
- Chat context builder: \`src/lib/buildChatContext.ts\`
- Chat edit parser: \`src/lib/parseChatEdits.ts\`
- Paper scalper engine: \`src/lib/scalperPaperEngine.ts\`, \`lib/scalperPaperConfig.ts\`
- PumpPortal WS: \`src/lib/pumpPortalRealtime.ts\`
- Order book UI: \`src/components/PumpOrderBook.tsx\`
- Nursery scanner: \`src/components/NurseryPanel.tsx\`, \`src/lib/nurseryEngine.ts\`
- LLM backends: \`src/lib/llmBackends.ts\`
- Types: \`src/types.ts\`
- Nav top bar: \`src/components/AppTopChrome.tsx\`
- Entry / workspace gate: \`src/App.tsx\`, \`src/components/ProjectGate.tsx\`

## File Apply
User opens local folder (File System Access API). Fenced blocks like \`\`\`typescript:src/Foo.tsx are applied directly to disk; Vite HMR reloads instantly.

## Chat context
Small, task-scoped state injected at send time. Build mode retrieves files with tools; do not assume a full repo digest is available.

## Rules for edits
1. Use real paths from search/read — never invent names.
2. Output complete file replacements (no partial diffs). One file per fenced block.
3. Knob changes → \`\`\`config JSON block (instant, no deploy).
4. Functional React, \`@/\` imports, Tailwind v4 utilities.
5. Never commit API keys.
6. Paper = simulation. Real = PumpPortal Lightning, real money.
`.trim();
}

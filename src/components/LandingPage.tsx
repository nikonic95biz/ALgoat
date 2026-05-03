import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Code2, GitBranch, Lock } from "lucide-react";

type LandingPageProps = {
  homeHref: string;
  workspaceHref: string;
  onOpenWorkspace: () => void;
};

const GH =
  typeof import.meta.env.VITE_GITHUB_REPO_URL === "string"
    ? import.meta.env.VITE_GITHUB_REPO_URL.trim()
    : "";

export function LandingPage({ homeHref, workspaceHref, onOpenWorkspace }: LandingPageProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onOpenWorkspace();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenWorkspace]);

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-[#070708] font-sans text-[#c4c9d2] antialiased">
      <PageBackground />
      <NavBar homeHref={homeHref} onOpenWorkspace={onOpenWorkspace} />
      <Hero workspaceHref={workspaceHref} onOpenWorkspace={onOpenWorkspace} />
      <PurposeSection />
      <StarterStrategies />
      <PrivacySection workspaceHref={workspaceHref} />
      <Footer onOpenWorkspace={onOpenWorkspace} />
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function NavBar({ homeHref, onOpenWorkspace }: { homeHref: string; onOpenWorkspace: () => void }) {
  return (
    <header className="relative z-20 border-b border-white/[0.05] bg-[#070708]/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <a
          href={homeHref}
          className="flex items-center gap-2 font-semibold tracking-tight text-[#eceff4]"
          onClick={(e) => { if (homeHref === window.location.pathname) e.preventDefault(); }}
        >
          <span className="text-[18px]">🫒</span>
          <span className="text-[15px] font-semibold">SolClaw</span>
        </a>
        <div className="flex items-center gap-2">
          {GH ? (
            <a
              href={GH}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg border border-white/[0.1] px-3 py-2 text-[13px] font-medium text-[#9aa4b2] transition-colors hover:border-white/[0.2] hover:text-[#eceff4] sm:inline-flex"
            >
              GitHub
            </a>
          ) : null}
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="group inline-flex items-center gap-1.5 rounded-lg bg-[#2EA8FF] px-3.5 py-2 text-[13px] font-semibold text-[#040d18] shadow-[0_0_24px_rgba(46,168,255,0.22)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
          >
            Open IDE
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2.6} />
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero({ workspaceHref, onOpenWorkspace }: { workspaceHref: string; onOpenWorkspace: () => void }) {
  return (
    <section className="relative z-10 mx-auto max-w-5xl px-5 pb-16 pt-20 sm:px-8 sm:pb-24 sm:pt-32">
      <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-3.5 py-1.5 text-[12px] font-medium text-[#9aa4b2]">
            <span>🫒</span>
            <span>Now live and open source</span>
          </div>

          <h1 className="mt-7 text-balance text-[2.75rem] font-semibold leading-[1.03] tracking-[-0.025em] text-[#f4f6fa] sm:text-[3.5rem] sm:leading-[1.01]">
            The first Algo trading IDE built for{" "}
            <span className="text-[#2EA8FF]">Solana memecoins.</span>
          </h1>

          <p className="mt-7 max-w-lg text-pretty text-[16px] leading-relaxed text-[#7a8494]">
            Live chart, order-book tape, and a token watcher — all in one browser tab. Build and
            test trading algorithms against the real feed, and let the AI iterate on your strategies
            directly inside the app. No backend, no signup, keys stay on your machine.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="group inline-flex items-center gap-2 rounded-xl bg-[#2EA8FF] px-6 py-3.5 text-[15px] font-semibold text-[#040d18] shadow-[0_0_40px_rgba(46,168,255,0.25)] transition-[filter,transform] hover:brightness-110 active:scale-[0.99]"
            >
              Open the IDE
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.6} />
            </button>
            {GH && (
              <a
                href={GH}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.02] px-6 py-3.5 text-[15px] font-medium text-[#dce1ea] transition-colors hover:border-[#2EA8FF]/35 hover:text-[#2EA8FF]"
              >
                <Code2 className="h-4 w-4" strokeWidth={2.2} />
                View source
              </a>
            )}
            {!GH && (
              <a
                href={workspaceHref}
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.02] px-6 py-3.5 text-[15px] font-medium text-[#dce1ea] transition-colors hover:border-[#2EA8FF]/35 hover:text-[#2EA8FF]"
              >
                <Code2 className="h-4 w-4" strokeWidth={2.2} />
                Direct link
              </a>
            )}
          </div>

          <div className="mt-10 grid grid-cols-3 gap-5 border-t border-white/[0.06] pt-8 max-w-sm">
            <Stat n="0" label="servers required" />
            <Stat n="MIT" label="open source" />
            <Stat n="100%" label="keys stay local" />
          </div>
        </div>

        <div className="relative">
          <ProductMock />
        </div>
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <dt className="text-[1.6rem] font-semibold leading-none tracking-tight text-[#eceff4]">{n}</dt>
      <dd className="mt-1.5 text-[11px] leading-snug text-[#5c6570]">{label}</dd>
    </div>
  );
}

// ── Purpose section ───────────────────────────────────────────────────────────

const PURPOSE_ITEMS = [
  {
    n: "01",
    title: "More control, less screen time",
    body: "Set rules, automate the repetitive part, and only look when it matters.",
  },
  {
    n: "02",
    title: "Build and run your own algos",
    body: "Write trading logic in plain code. The AI can help you iterate it directly in the app.",
  },
  {
    n: "03",
    title: "Monitor the market with structure",
    body: "Nursery, tape, chart — everything in one tab. Filter the noise, track what matters.",
  },
  {
    n: "04",
    title: "Validate before you deploy capital",
    body: "Run any strategy on the live feed without spending a SOL. Tune it until the numbers are right.",
  },
  {
    n: "05",
    title: "Real trading when you're ready",
    body: "Flip to live mode. PumpPortal Lightning executes from your wallet directly.",
  },
  {
    n: "06",
    title: "AI that sees your actual environment",
    body: "Unlike Cursor or external tools, the LLM here has native access to your dashboard state, live data, and codebase — all at once.",
  },
];

function PurposeSection() {
  return (
    <section className="relative z-10 border-t border-white/[0.05]">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
        <SectionLabel>Built for traders</SectionLabel>
        <h2 className="mt-4 text-balance text-[1.85rem] font-semibold leading-[1.12] tracking-[-0.015em] text-[#f2f4f8] sm:text-[2.3rem]">
          Six problems SolClaw solves.
        </h2>
        <div className="mt-12 grid gap-px bg-white/[0.04] sm:grid-cols-2 lg:grid-cols-3 rounded-2xl overflow-hidden border border-white/[0.05]">
          {PURPOSE_ITEMS.map((item) => (
            <div key={item.n} className="group bg-[#070708] p-6 transition-colors hover:bg-white/[0.02]">
              <span className="font-mono text-[11px] text-[#2EA8FF]/60">{item.n}</span>
              <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-[#e8edf4]">{item.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[#6e7782]">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Starter strategies ────────────────────────────────────────────────────────

function StarterStrategies() {
  return (
    <section className="relative z-10 border-t border-white/[0.05]">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
        <SectionLabel>Proven strategies</SectionLabel>
        <h2 className="mt-4 text-balance text-[1.85rem] font-semibold leading-[1.12] tracking-[-0.015em] text-[#f2f4f8] sm:text-[2.3rem]">
          Two strategies that have worked.
        </h2>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-[#2EA8FF]/25 bg-[#2EA8FF]/[0.07] text-[16px]">
                ⚡
              </div>
              <h3 className="text-[15.5px] font-semibold text-[#eceff4]">Scalper Bot</h3>
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed text-[#6e7782]">
              Runs on the live PumpPortal tape — dip detection, entry, take-profit, stop-loss. Paper mode by default.
              Tune the parameters in the built-in IDE and deploy instantly.
            </p>
          </div>

          <div className="rounded-2xl border border-[#2EA8FF]/15 bg-[#2EA8FF]/[0.03] p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-[#2EA8FF]/25 bg-[#2EA8FF]/[0.07] text-[16px]">
                🫒
              </div>
              <h3 className="text-[15.5px] font-semibold text-[#eceff4]">Zombie revival — bonded coins</h3>
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed text-[#6e7782]">
              The Nursery tracks hundreds of graduated coins around the clock, scoring each one for volume
              acceleration and buy pressure. Catch the revival before it moves.
            </p>
            <div className="mt-4 space-y-2.5">
              <TradeExample coin="Chonkers" from="$7k" to="$2.4M" note="pumped 1 week after bonding" />
              <TradeExample coin="Simulator" from="$9k" to="$400k" note="pumped 29 days after bonding" />
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          <MiniFeature icon={<Code2 className="h-4 w-4" />} title="In-browser IDE">
            Monaco editor with the full codebase bundled. Edit your algos without leaving the tab.
          </MiniFeature>
          <MiniFeature icon={<GitBranch className="h-4 w-4" />} title="GitHub native">
            Fork in two clicks. The AI commits straight to your fork.
          </MiniFeature>
          <MiniFeature icon={<Lock className="h-4 w-4" />} title="Local-first">
            Keys, wallet, chat history — all in your browser. No backend.
          </MiniFeature>
        </div>
      </div>
    </section>
  );
}

function TradeExample({ coin, from, to, note }: { coin: string; from: string; to: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
      <span className="shrink-0 text-[13px] font-semibold text-[#dce1ea]">{coin}</span>
      <span className="text-[12px] text-[#4a5260]">{from}</span>
      <span className="text-[11px] text-[#3a4050]">→</span>
      <span className="text-[13px] font-semibold text-[#2EA8FF]">{to}</span>
      <span className="ml-auto text-[11px] text-[#3a4050]">{note}</span>
    </div>
  );
}

function MiniFeature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-4">
      <div className="flex items-center gap-2 text-[#2EA8FF]">{icon}<span className="text-[13px] font-semibold text-[#dce1ea]">{title}</span></div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[#5c6570]">{children}</p>
    </div>
  );
}

// ── Privacy / infrastructure ──────────────────────────────────────────────────

function PrivacySection({ workspaceHref }: { workspaceHref: string }) {
  return (
    <section className="relative z-10 border-t border-white/[0.05]">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <SectionLabel>Privacy</SectionLabel>
            <h2 className="mt-4 text-balance text-[1.85rem] font-semibold leading-[1.12] tracking-[-0.015em] text-[#f2f4f8] sm:text-[2.1rem]">
              Your keys, your machine.
            </h2>
            <p className="mt-5 text-[14px] leading-relaxed text-[#6e7782]">
              PumpPortal key, LLM key, GitHub PAT, wallet — all stored in your browser's{" "}
              <code className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[12px] text-[#aab4c3]">
                localStorage
              </code>
              . Nothing is sent to any server we operate.
            </p>
            <ul className="mt-5 space-y-2.5 text-[13.5px] text-[#6e7782]">
              <li className="flex gap-2.5"><span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#2EA8FF]/60" />No telemetry. Open the network tab and look.</li>
              <li className="flex gap-2.5"><span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#2EA8FF]/60" />Static SPA. Self-host on Vercel, Netlify, Cloudflare Pages, or your own machine.</li>
              <li className="flex gap-2.5"><span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#2EA8FF]/60" />Lightning trades execute from the wallet PumpPortal links to your API key.</li>
            </ul>
          </div>

          <div>
            <SectionLabel>Infrastructure</SectionLabel>
            <h2 className="mt-4 text-balance text-[1.85rem] font-semibold leading-[1.12] tracking-[-0.015em] text-[#f2f4f8] sm:text-[2.1rem]">
              Free APIs by default.
            </h2>
            <p className="mt-5 text-[14px] leading-relaxed text-[#6e7782]">
              Runs on public APIs out of the box — PumpPortal WebSocket, pump.fun REST, and DexScreener. Zero
              infrastructure cost to get started.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-[#4a5260]">
              Scale up when you're ready: faster RPC, upgraded PumpPortal tier, dedicated LLM key. Every
              integration is a single config swap in the Setup panel.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-xl border border-white/[0.07] bg-[#0c0d10] p-4 font-mono text-[11.5px] leading-relaxed text-[#6e7782]">
{`$ git clone <your-fork>
$ npm install
$ npm run dev
# → http://localhost:5173${workspaceHref}`}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return (
    <footer className="relative z-10 border-t border-white/[0.05]">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="rounded-2xl border border-[#2EA8FF]/15 bg-[linear-gradient(180deg,rgba(46,168,255,0.05),transparent)] p-8 sm:p-10 text-center">
          <div className="text-[2rem]">🫒</div>
          <h3 className="mt-4 text-balance text-[1.5rem] font-semibold tracking-tight text-[#eceff4] sm:text-[1.85rem]">
            Open source. No signup. Start trading.
          </h3>
          <p className="mx-auto mt-3 max-w-md text-[14px] text-[#6e7782]">
            No signup. No backend. Load a mint, watch the tape, build something.
          </p>
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="group mt-7 inline-flex items-center gap-2 rounded-xl bg-[#2EA8FF] px-6 py-3.5 text-[15px] font-semibold text-[#040d18] shadow-[0_0_40px_rgba(46,168,255,0.25)] transition-[filter,transform] hover:brightness-110 active:scale-[0.99]"
          >
            Open the IDE
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.6} />
          </button>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 text-[12px] text-[#3a4050] sm:flex-row">
          <p>🫒 SolClaw · Open source · MIT · Nothing here is financial advice.</p>
          <p className="font-mono">v0.1</p>
        </div>
      </div>
    </footer>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#2EA8FF]/70">
      {children}
    </p>
  );
}

// ── Product mock (right side of hero) ────────────────────────────────────────

function ProductMock() {
  const ticks = useMemo(() => buildSparklineTicks(), []);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow((t) => t + 1), 1800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 rounded-3xl bg-[radial-gradient(ellipse_at_center,rgba(46,168,255,0.1),transparent_60%)] blur-2xl"
      />
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0c0d10] shadow-[0_50px_120px_-30px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.03)]">
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-white/[0.05] bg-[#0a0b0e] px-3.5 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff6a6a]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#f5b942]/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#2EA8FF]/70" />
          </div>
          <div className="font-mono text-[10.5px] tracking-[0.05em] text-[#4a5260]">SolClaw · /app</div>
          <div className="flex items-center gap-1.5 text-[#2EA8FF]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2EA8FF]" />
            <span className="font-mono text-[10px] tracking-[0.06em]">LIVE</span>
          </div>
        </div>

        <div className="grid gap-px bg-white/[0.03] sm:grid-cols-[1.4fr_1fr]">
          {/* Chart panel */}
          <div className="bg-[#0c0d10] p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[#aab4c3]">PEPE</span>
                <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#5c6570]">1m</span>
              </div>
              <span className="font-mono tabular-nums text-[#2EA8FF]">+12.4%</span>
            </div>
            <div className="relative h-40 overflow-hidden rounded-lg border border-white/[0.04] bg-[linear-gradient(180deg,rgba(46,168,255,0.04),transparent_60%)]">
              <Sparkline ticks={ticks} />
              <div className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-end px-3 font-mono text-[10px] text-[#4a5260]">
                MC $382K
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10.5px] tabular-nums">
              <MockStat label="price" value="$0.00021" up />
              <MockStat label="vol 24h" value="412◎" />
              <MockStat label="liq" value="24 SOL" accent />
            </div>
          </div>

          {/* Algo side */}
          <div className="bg-[#0a0b0e] p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-mono uppercase tracking-[0.12em] text-[#4a5260]">Nursery</span>
              <span className="rounded-full bg-[#2EA8FF]/10 px-2 py-0.5 font-mono text-[10px] text-[#2EA8FF]">
                live
              </span>
            </div>
            <div className="space-y-1.5 rounded-lg border border-white/[0.05] bg-white/[0.01] p-2.5 font-mono text-[10.5px]">
              <NurseryMockRow name="CHONK" mc="$7k→$2.4M" score={5} />
              <NurseryMockRow name="SIM" mc="$9k→$400k" score={4} />
              <NurseryMockRow name="NOVA" mc="$11k" score={3} />
              <NurseryMockRow name="DUSK" mc="$15k" score={2} />
            </div>
            <div className="mt-3 space-y-1 font-mono text-[10.5px] tabular-nums">
              <TapeRow buy sol="0.42" mc="$381.6K" />
              <TapeRow sol="0.18" mc="$378.2K" />
              <TapeRow buy sol="1.10" mc="$382.0K" highlight />
              <TapeRow sol="0.09" mc="$379.0K" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.05] bg-[#0a0b0e] px-3.5 py-2 font-mono text-[10.5px] text-[#3a4050]">
          <span>🫒 SolClaw</span>
          <span className="flex items-center gap-1.5 text-[#2EA8FF]/70">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2EA8FF]/70" />
            <span className="tabular-nums">{String(now % 60).padStart(2, "0")}s ago</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function MockStat({ label, value, up, accent }: { label: string; value: string; up?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.04] bg-white/[0.015] px-2 py-1.5">
      <div className="text-[9.5px] uppercase tracking-[0.1em] text-[#3a4050]">{label}</div>
      <div className={`mt-0.5 ${up ? "text-[#4ade80]/80" : accent ? "text-[#2EA8FF]" : "text-[#dce1ea]"}`}>{value}</div>
    </div>
  );
}

function NurseryMockRow({ name, mc, score }: { name: string; mc: string; score: number }) {
  const bar = "●".repeat(score) + "○".repeat(5 - score);
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-[#aab4c3]">{name}</span>
      <span className="text-[#4a5260]">{mc}</span>
      <span className={`font-mono ${score >= 4 ? "text-[#2EA8FF]" : score >= 3 ? "text-[#6e7782]" : "text-[#3a4050]"}`}>{bar}</span>
    </div>
  );
}

function TapeRow({ buy, sol, mc, highlight }: { buy?: boolean; sol: string; mc: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md px-1.5 py-0.5 ${highlight ? "bg-[#2EA8FF]/8 ring-1 ring-[#2EA8FF]/15" : ""}`}>
      <span className={buy ? "text-[#4ade80]/70" : "text-[#ff8f8f]/70"}>{buy ? "BUY" : "SELL"}</span>
      <span className="text-[#6e7782]">{sol}</span>
      <span className="text-[#4a5260]">{mc}</span>
    </div>
  );
}

function Sparkline({ ticks }: { ticks: number[] }) {
  const w = 320, h = 140;
  const max = Math.max(...ticks), min = Math.min(...ticks);
  const range = max - min || 1;
  const stepX = w / (ticks.length - 1);
  const points = ticks.map((v, i) => `${i * stepX},${h - ((v - min) / range) * h * 0.82 - 8}`).join(" ");
  const area = `0,${h} ${points} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2EA8FF" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#2EA8FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline points={points} fill="none" stroke="#2EA8FF" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function buildSparklineTicks(): number[] {
  const out: number[] = [];
  let v = 30;
  for (let i = 0; i < 64; i++) {
    const drift = Math.sin(i / 4.2) * 4 + (i / 64) * 26;
    const noise = (i * 9301 + 49297) % 233280;
    const r = (noise / 233280 - 0.5) * 5;
    v = Math.max(8, Math.min(95, 30 + drift + r));
    out.push(v);
  }
  return out;
}

function PageBackground() {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 120% 70% at 50% -5%, rgba(46,168,255,0.13), transparent 55%), radial-gradient(ellipse 50% 40% at 90% 20%, rgba(46,168,255,0.05), transparent 55%)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.018]"
        aria-hidden
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(0,0,0,0.9), transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(0,0,0,0.9), transparent 80%)",
        }}
      />
    </>
  );
}

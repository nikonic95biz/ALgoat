import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, FileCode2, GitBranch } from "lucide-react";
import { LandingPageBackground } from "@/components/LandingBackground";

const GH =
  typeof import.meta.env.VITE_GITHUB_REPO_URL === "string"
    ? import.meta.env.VITE_GITHUB_REPO_URL.trim()
    : "";

export type ReleaseNotesPageProps = {
  homeHref: string;
  workspaceHref: string;
  changelogHref: string;
  onOpenWorkspace: () => void;
};

/**
 * Public-facing engineering changelog — mirrors CHANGELOG.md at a route-safe URL.
 * Styled like an internal release doc for handoff / audit trail.
 */
export function ReleaseNotesPage({
  homeHref,
  workspaceHref,
  changelogHref,
  onOpenWorkspace,
}: ReleaseNotesPageProps) {
  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-[#070708] font-sans text-[#c4c9d2] antialiased">
      <LandingPageBackground />
      <header className="relative z-20 border-b border-white/[0.05] bg-[#070708]/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <a
            href={homeHref}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-[#9aa4b2] transition-colors hover:text-[#eceff4]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.4} />
            Home
          </a>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#4a5260]">release notes</span>
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-[13px] font-medium text-[#9aa4b2] transition-colors hover:border-white/[0.2] hover:text-[#eceff4]"
          >
            Open app
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        </div>
      </header>

      <article className="relative z-10 mx-auto max-w-3xl px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#2EA8FF]/25 bg-[#2EA8FF]/[0.06] px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#2EA8FF]/90">
          <FileCode2 className="h-3.5 w-3.5" strokeWidth={2.2} />
          Engineering changelog
        </div>

        <h1 className="mt-6 text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.02em] text-[#f4f6fa] sm:text-[2.35rem]">
          SolClaw <span className="text-[#2EA8FF]">v1.1</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#7a8494]">
          Structured release log for deploy verification and fork maintainers. Scope: chart data pipeline,
          bounce-zone subsystem, scalper state machine, Lightning execution fallbacks, chat/runtime integration,
          and performance UI.
        </p>

        <dl className="mt-8 grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 font-mono text-[12px] text-[#9aa4b2] sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.12em] text-[#4a5260]">Release tag</dt>
            <dd className="mt-1 tabular-nums text-[#dce1ea]">v1.1</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.12em] text-[#4a5260]">Cut date</dt>
            <dd className="mt-1 tabular-nums text-[#dce1ea]">2026-05-04 (UTC)</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-[#4a5260]">Primary touched paths</dt>
            <dd className="mt-1 break-all text-[11px] leading-snug text-[#6e7782]">
              CaChartPanel.tsx · pumpCandles.ts · chartBounceZones.ts · visionBounceDetect.ts · scalperPaperEngine.ts ·
              pumpPortalLightningTrade.ts · AppContext.tsx · ChatPanel.tsx · parseChatEdits.ts · localWorkspace.ts ·
              PerformancePanel.tsx · DashboardViewport.tsx
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-[#4a5260]">Canonical markdown</dt>
            <dd className="mt-1">
              <a
                href={GH ? `${GH}/blob/main/CHANGELOG.md` : changelogHref}
                target="_blank"
                rel="noreferrer"
                className="text-[#2EA8FF]/85 underline-offset-2 hover:text-[#2EA8FF] hover:underline"
              >
                CHANGELOG.md in repo root
              </a>
            </dd>
          </div>
        </dl>

        <hr className="my-12 border-white/[0.06]" />

        <Section id="data" title="01 · Data pipeline & charting">
          <Subheading>Lazy historical fetch</Subheading>
          <p>
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px] text-[#aab4c3]">
              subscribeVisibleLogicalRangeChange
            </code>{" "}
            on lightweight-charts triggers isolated{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">fetchPumpCandles(..., beforeTs)</code>{" "}
            requests when the viewport approaches the oldest loaded bar (guard{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">isFetchingOlderRef</code>
            , termination{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">hasReachedGenesisRef</code>). Applies
            across intervals <span className="font-mono text-[11px] text-[#9aa4b2]">1s · 5s · 1m · 5m · 15m</span>.
          </p>
          <Subheading>5s bucket (client resample)</Subheading>
          <p>
            Pump REST returns 1s series only for sub-minute granularity.{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">resampleCandles</code> aggregates into 5s
            OHLC. Genesis detection uses{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">rawFetchedCount</code> on{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">PumpCandlesResult</code> so partial-page
            semantics remain correct after resampling.
          </p>
          <Subheading>Poll merge invariant (regression fix)</Subheading>
          <p>
            Periodic REST polls merge only the <strong className="text-[#dce1ea]">last two</strong> timestamps already
            present in client state. Historical overlap between poll payload and initial paged load is ignored — avoids
            mixing MC-axis multiplier snapshots across requests (symptom: vertically stretched / “needle” candles).
          </p>
          <Subheading>Cache layer</Subheading>
          <p>
            In-memory key{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">{`${"${mint}:${interval}"}`}</code> with{" "}
            <span className="font-mono text-[11px]">TTL ≈ 90s</span>. Default interval for new CA load set to{" "}
            <span className="font-mono text-[11px]">5s</span>.
          </p>
        </Section>

        <Section id="bounce" title="02 · Bounce zone subsystem">
          <Subheading>Algo path</Subheading>
          <ul className="list-disc space-y-2 pl-5 marker:text-[#3a4050]">
            <li>
              Auto-detect on <strong className="text-[#dce1ea]">first chart settle per mint</strong> (no billed LLM
              calls).
            </li>
            <li>
              Hard separation threshold between drawn zones: greedy dedupe at{" "}
              <span className="font-mono text-[11px]">15%</span>, secondary guard inside{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">redrawBounceLinesOnSeries</code>.
            </li>
            <li>
              Minimum distance below spot: <span className="font-mono text-[11px]">FLOOR_MARGIN_FRAC = 0.07</span> in{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">chartBounceZones.ts</code>; mirrored in
              vision post-filter, drag clamp, and context mutations.
            </li>
            <li>
              Sparse bootstrap when{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">floorDetectionRows.length &lt; MIN_BOOTSTRAP_CANDLES</code>.
            </li>
          </ul>
          <Subheading>Vision path (BETA)</Subheading>
          <p>
            Offscreen chart capture → base64 → provider routing via{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">resolveLlmApiUrl</code>. Manual trigger
            only after first load; labeled BETA in UI with spend warning strip.
          </p>
        </Section>

        <Section id="scalper" title="03 · Scalper engine">
          <ul className="list-disc space-y-2 pl-5 marker:text-[#3a4050]">
            <li>
              New transient state <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">nearing</code> —
              asymmetric band around zone vs spot; removed prior dip prerequisite that delayed transitions when zones were
              edited live.
            </li>
            <li>
              Configurable <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">reentryCooldownMs</code>{" "}
              (default <span className="font-mono text-[11px]">30_000</span>) to prevent duplicate entries.
            </li>
            <li>
              Sidebar knobs remain editable during active session (removed blanket{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">disabled</code> gate).
            </li>
          </ul>
        </Section>

        <Section id="execution" title="04 · Real execution & accounting">
          <ul className="list-disc space-y-2 pl-5 marker:text-[#3a4050]">
            <li>
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">
                postPumpPortalLightningTradeWithFallback
              </code>
              : retries venue stack on program error <span className="font-mono text-[11px]">6005</span> (bonding
              migrated → AMM / Raydium).
            </li>
            <li>
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">realPositionOpenRef</code>: sells gated
              on confirmed on-chain buy acknowledgement (mitigates 400s / phantom flatten).
            </li>
            <li>
              Manual <strong className="text-[#dce1ea]">Sell All</strong> affordance when{" "}
              <span className="font-mono text-[11px]">real</span> session +{" "}
              <span className="font-mono text-[11px]">in_trade</span>.
            </li>
            <li>
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">fetchWalletSolDeltaSol</code>: extended
              backoff / retry budget for signer-attributed SOL delta reads.
            </li>
          </ul>
        </Section>

        <Section id="chat" title="05 · Chat / IDE integration">
          <ul className="list-disc space-y-2 pl-5 marker:text-[#3a4050]">
            <li>
              File System Access API workspace wrapper (
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">localWorkspace.ts</code>) + IndexedDB
              directory-handle persistence.
            </li>
            <li>
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">parseConfigPatch</code>: fenced{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">{"```config"}</code> blocks → partial{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">ScalperUserConfig</code> apply without
              redeploy.
            </li>
            <li>
              Composer prompt updated to distinguish runtime config blocks vs repository file edits.
            </li>
          </ul>
        </Section>

        <Section id="ui" title="06 · Shell & analytics UI">
          <ul className="list-disc space-y-2 pl-5 marker:text-[#3a4050]">
            <li>
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">CaChartPanel</code> remains mounted
              across workspace tabs — visibility toggled via CSS to preserve chart instance state.
            </li>
            <li>
              Performance surface rewritten as unified table (
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">PersistedTradesTable</code>): real +
              paper rows, exit metadata, outbound links.
            </li>
          </ul>
        </Section>

        <Section id="verify" title="07 · Verification checklist (deploy / fork)">
          <ol className="list-decimal space-y-2 pl-5 marker:text-[#4a5260]">
            <li>
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">npm run build</code> — zero TypeScript
              errors.
            </li>
            <li>
              Lazy pan-left on 1s / 5s — network tab shows discrete{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">beforeTs</code> fetches, no duplicate
              in-flight storms.
            </li>
            <li>
              30s poll does not mutate OHLC for bars older than T−2 relative to series tail.
            </li>
            <li>
              Vision refresh increments billed usage; first-load algo detect does not call LLM.
            </li>
          </ol>
        </Section>

        <div className="mt-16 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#4a5260]">Next actions</p>
          <p className="mt-2 text-[14px] leading-relaxed text-[#7a8494]">
            Fork maintainers: pin this page URL in your internal runbook. Source-of-truth prose remains{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">CHANGELOG.md</code> for diff review in PRs.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={GH || "https://github.com/Enrichfun/solclaw"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#2EA8FF] px-4 py-2.5 text-[13px] font-semibold text-[#040d18]"
            >
              <GitBranch className="h-4 w-4" strokeWidth={2.4} />
              Repository
            </a>
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] px-4 py-2.5 text-[13px] font-medium text-[#dce1ea]"
            >
              Launch workspace
              <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <p className="mt-10 text-center font-mono text-[11px] text-[#3a4050]">
          This route: <span className="text-[#5c6570]">{changelogHref}</span> · Workspace:{" "}
          <span className="text-[#5c6570]">{workspaceHref}</span>
        </p>
      </article>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-14 scroll-mt-24">
      <h2 className="border-b border-white/[0.06] pb-3 font-mono text-[13px] font-semibold uppercase tracking-[0.16em] text-[#2EA8FF]/85">
        {title}
      </h2>
      <div className="mt-5 space-y-4 text-[14px] leading-relaxed text-[#8b95a5]">{children}</div>
    </section>
  );
}

function Subheading({ children }: { children: ReactNode }) {
  return <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6e7782]">{children}</h3>;
}

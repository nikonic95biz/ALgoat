// ─── Chat empty state — imported by ChatPanel ───────────────────────────────
// Extracted to avoid inline template-literal escaping issues in append scripts.

import { ChevronRight } from "lucide-react";

export type ChatEmptyStateProps = {
  showMissingKeyBanner: boolean;
  localWorkspaceConnected: boolean;
  githubWired: boolean;
  onOpenSetup: () => void;
  onSend: (text: string) => void;
};

const STARTER_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: "Design an entry strategy",
    prompt:
      "Design a dip-buy entry strategy for low-cap pump.fun launches. Use order-book buy pressure as the catalyst.",
  },
  {
    label: "Tighten stop loss logic",
    prompt: "Audit the current stop loss logic and suggest tighter risk controls.",
  },
  {
    label: "Add a volume spike filter",
    prompt:
      "Add a volume spike filter — only enter if buy volume in the last 10 ticks exceeds a threshold.",
  },
  {
    label: "Explain the paper scalper",
    prompt:
      "Walk me through exactly how the paper scalper state machine works — states, transitions, when it fires a buy.",
  },
  {
    label: "Set catalyst SOL to 0.3",
    prompt: "Set the minimum buy catalyst to 0.3 SOL.",
  },
  {
    label: "What can I edit from here?",
    prompt:
      "What parts of the app can I change from this chat? Show me a quick example — a config change and a file edit.",
  },
];

export function ChatEmptyState({
  showMissingKeyBanner,
  localWorkspaceConnected,
  githubWired,
  onOpenSetup,
  onSend,
}: ChatEmptyStateProps) {
  const editDesc = localWorkspaceConnected
    ? "Writes to your local repo → Vite HMR reloads in < 100 ms."
    : githubWired
      ? "Proposes diff → Apply commits to your GitHub repo."
      : "Connect GitHub or a local workspace in Setup to apply edits.";

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3.5 py-5">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-[12.5px] font-semibold text-[var(--color-fg)]">SolClaw · Algo IDE</p>
        <p className="text-[11.5px] leading-relaxed text-[var(--color-fg-dim)]">
          Live chart state, file tree, and full codebase context injected on every message. Propose
          code changes, apply them to disk or GitHub, tweak trading knobs — no redeploy.
        </p>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-1.5">
        <IdeStatusChip
          ok={!showMissingKeyBanner}
          okLabel="LLM key connected"
          failLabel="No LLM key"
          onFail={onOpenSetup}
        />
        <IdeStatusChip
          ok={githubWired}
          okLabel="GitHub wired"
          failLabel="GitHub not wired"
          onFail={onOpenSetup}
        />
        <IdeStatusChip
          ok={localWorkspaceConnected}
          okLabel="Local workspace · instant HMR"
          failLabel="No local workspace"
          neutral
          onFail={onOpenSetup}
        />
      </div>

      {/* Capability grid */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">
          What this IDE can do
        </p>
        <div className="grid gap-2">
          <IdeCapRow
            badge="config"
            badgeColor="text-[#2EA8FF] bg-[#2EA8FF]/10 border-[#2EA8FF]/25"
            title="Live knob changes"
            desc="Change dip %, catalyst SOL, take profit, stop loss, slippage — applies instantly to the running bot, no redeploy."
          />
          <IdeCapRow
            badge="file edit"
            badgeColor="text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
            title="Code changes"
            desc={editDesc}
          />
          <IdeCapRow
            badge="context"
            badgeColor="text-[#f5b942] bg-[#f5b942]/10 border-[#f5b942]/25"
            title="Live chart state"
            desc="Every message includes active mint, last candle OHLC, scalper status, trade tape, and your open file."
          />
        </div>
      </div>

      {/* Starter prompts */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">
          Start here
        </p>
        <div className="flex flex-col gap-1.5">
          {STARTER_PROMPTS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onSend(p.prompt)}
              className="group flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-3 py-2 text-left text-[12px] text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-fg)]"
            >
              <span>{p.label}</span>
              <ChevronRight
                className="size-3.5 shrink-0 opacity-30 transition-opacity group-hover:opacity-70"
                strokeWidth={2.5}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function IdeStatusChip({
  ok,
  okLabel,
  failLabel,
  neutral,
  onFail,
}: {
  ok: boolean;
  okLabel: string;
  failLabel: string;
  neutral?: boolean;
  onFail: () => void;
}) {
  if (ok) {
    return (
      <span
        className={
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium " +
          (neutral
            ? "border-[var(--color-border-subtle)] text-[var(--color-fg-dim)]"
            : "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-400/80")
        }
      >
        <span
          className={
            "size-1.5 rounded-full " + (neutral ? "bg-[var(--color-fg-dim)]" : "bg-emerald-400/70")
          }
        />
        {okLabel}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onFail}
      className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/[0.06] px-2 py-0.5 text-[10.5px] font-medium text-red-400/70 transition-colors hover:border-red-500/40 hover:text-red-400"
    >
      <span className="size-1.5 rounded-full bg-red-400/60" />
      {failLabel} · Setup ↗
    </button>
  );
}

function IdeCapRow({
  badge,
  badgeColor,
  title,
  desc,
}: {
  badge: string;
  badgeColor: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-3 py-2.5">
      <span
        className={
          "mt-px shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] " +
          badgeColor
        }
      >
        {badge}
      </span>
      <div>
        <p className="text-[12px] font-medium text-[var(--color-fg-muted)]">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-fg-dim)]">{desc}</p>
      </div>
    </div>
  );
}

// ─── Chat empty state — imported by ChatPanel ───────────────────────────────
import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { LlmConnectCard } from "@/components/LlmConnectCard";
import type { ModelSettings } from "@/types";

export type ChatEmptyStateProps = {
  showMissingKeyBanner: boolean;
  localWorkspaceConnected: boolean;
  githubWired: boolean;
  model: ModelSettings;
  onSetModel: (patch: Partial<ModelSettings>) => void;
  onSend: (text: string) => void;
};

const STARTER_PROMPTS = [
  { label: "Design an entry strategy", prompt: "Design a dip-buy entry strategy for low-cap pump.fun launches. Use order-book buy pressure as the catalyst." },
  { label: "Tighten stop loss logic", prompt: "Audit the current stop loss logic and suggest tighter risk controls." },
  { label: "Add a volume spike filter", prompt: "Add a volume spike filter — only enter if buy volume in the last 10 ticks exceeds a threshold." },
  { label: "Explain the paper scalper", prompt: "Walk me through exactly how the paper scalper state machine works — states, transitions, when it fires a buy." },
  { label: "Set catalyst SOL to 0.3", prompt: "Set the minimum buy catalyst to 0.3 SOL." },
];

export function ChatEmptyState({
  showMissingKeyBanner,
  localWorkspaceConnected,
  githubWired,
  model,
  onSetModel,
  onSend,
}: ChatEmptyStateProps) {
  const [setupDone, setSetupDone] = useState(!showMissingKeyBanner);

  useEffect(() => {
    if (!showMissingKeyBanner) setSetupDone(true);
  }, [showMissingKeyBanner]);

  const showSetup = showMissingKeyBanner && !setupDone;

  const editDesc = localWorkspaceConnected
    ? "Writes to your local repo → Vite HMR reloads in < 100 ms."
    : githubWired
      ? "Proposes diff → Apply commits to your GitHub repo."
      : "Connect a local workspace in the Code panel to apply edits.";

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-4">
      <div className="space-y-0.5">
        <p className="text-[12.5px] font-semibold text-[var(--color-fg)]">SolClaw · Algo IDE</p>
        <p className="text-[11px] leading-relaxed text-[var(--color-fg-dim)]">
          Full codebase context on every message — propose changes, apply to disk, tweak trading knobs.
        </p>
      </div>

      {showSetup ? (
        <div className="rounded-xl border border-cyan-400/18 bg-[rgba(34,211,238,0.03)] p-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-amber-400/70" />
            <p className="text-[12px] font-semibold text-[var(--color-fg)]">Connect your LLM</p>
          </div>
          <LlmConnectCard
            model={model}
            onSave={(patch) => { onSetModel(patch); setSetupDone(true); }}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <StatusChip ok label="LLM connected" />
            <StatusChip ok={githubWired} label={githubWired ? "GitHub wired" : "GitHub not wired"} />
            <StatusChip ok={localWorkspaceConnected} label={localWorkspaceConnected ? "Local workspace" : "No local workspace"} neutral={!localWorkspaceConnected} />
          </div>

          <div className="grid gap-1.5">
            <CapRow badge="config" color="text-[#2EA8FF] bg-[#2EA8FF]/10 border-[#2EA8FF]/25" title="Live knob changes" desc="Dip %, catalyst SOL, take profit, stop loss — instant, no redeploy." />
            <CapRow badge="file edit" color="text-emerald-300 bg-emerald-500/10 border-emerald-500/25" title="Code changes" desc={editDesc} />
            <CapRow badge="context" color="text-[#f5b942] bg-[#f5b942]/10 border-[#f5b942]/25" title="Live state" desc="Active mint, last candle, scalper status, tape — injected every message." />
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">Start here</p>
            <div className="flex flex-col gap-1">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onSend(p.prompt)}
                  className="group flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-3 py-2 text-left text-[11.5px] text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-fg)]"
                >
                  <span>{p.label}</span>
                  <ChevronRight className="size-3.5 shrink-0 opacity-25 transition-opacity group-hover:opacity-60" strokeWidth={2.5} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusChip({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  const color = neutral
    ? "border-[var(--color-border-subtle)] text-[var(--color-fg-dim)]"
    : ok ? "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-400/80"
    : "border-red-500/20 bg-red-500/[0.06] text-red-400/70";
  const dot = neutral ? "bg-[var(--color-fg-dim)]" : ok ? "bg-emerald-400/70" : "bg-red-400/60";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${color}`}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function CapRow({ badge, color, title, desc }: { badge: string; color: string; title: string; desc: string }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-3 py-2">
      <span className={`mt-px shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] ${color}`}>{badge}</span>
      <div>
        <p className="text-[11.5px] font-medium text-[var(--color-fg-muted)]">{title}</p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--color-fg-dim)]">{desc}</p>
      </div>
    </div>
  );
}

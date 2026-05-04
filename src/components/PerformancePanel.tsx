import { useMemo, useState } from "react";
import { useApp, type PersistedBotTrade } from "@/context/AppContext";
import { BotTradesBook } from "@/components/BotTradesBook";
import { formatSol } from "@/lib/formatUsd";
import type { BotTradeRow } from "@/lib/scalperPaperEngine";

type ModeFilter = "all" | "real" | "paper";

function StatCard({ label, value, sub, positive }: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5" style={{ background: "var(--color-fill)" }}>
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">{label}</span>
      <span className={
        "text-[15px] font-semibold tabular-nums " +
        (positive === true ? "text-emerald-300" : positive === false ? "text-red-400" : "text-[var(--color-fg)]")
      }>
        {value}
      </span>
      {sub ? <span className="text-[10px] text-[var(--color-fg-dim)]">{sub}</span> : null}
    </div>
  );
}

function tradeAsRow(t: PersistedBotTrade): BotTradeRow {
  return t as BotTradeRow;
}

export function PerformancePanel() {
  const { persistedBotTrades, clearPersistedTrades } = useApp();
  const [mode, setMode] = useState<ModeFilter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    if (mode === "real") return persistedBotTrades.filter((t) => t.kind === "chain");
    if (mode === "paper") return persistedBotTrades.filter((t) => t.kind === "tape");
    return persistedBotTrades;
  }, [persistedBotTrades, mode]);

  // Stats derived from ALL trades (not filter-dependent so the cards always reflect truth)
  const chainTrades = useMemo(() => persistedBotTrades.filter((t) => t.kind === "chain"), [persistedBotTrades]);
  const paperTrades = useMemo(() => persistedBotTrades.filter((t) => t.kind === "tape"), [persistedBotTrades]);

  const chainNetSol = chainTrades.reduce((s, t) => s + (t.kind === "chain" ? t.netSol : 0), 0);
  const chainWins = chainTrades.filter((t) => t.kind === "chain" && t.netSol > 0).length;
  const chainWinRate = chainTrades.length > 0 ? (chainWins / chainTrades.length) * 100 : null;

  const paperWins = paperTrades.filter((t) => t.kind === "tape" && t.pnlPct > 0).length;
  const paperWinRate = paperTrades.length > 0 ? (paperWins / paperTrades.length) * 100 : null;
  const paperMcSum = paperTrades.reduce((s, t) => s + (t.kind === "tape" ? t.pnlPct : 0), 0);
  const paperEstLegs = paperTrades.filter((t) => t.kind === "tape" && t.paperSolEstimate != null);
  const paperEstNet = paperEstLegs.reduce((s, t) => s + (t.kind === "tape" && t.paperSolEstimate ? t.paperSolEstimate.netSol : 0), 0);

  // Unique wallets
  const wallets = useMemo(() => [...new Set(persistedBotTrades.map((t) => t.walletPk))], [persistedBotTrades]);
  const mints = useMemo(() => [...new Set(persistedBotTrades.map((t) => t.mint))], [persistedBotTrades]);

  const filteredAsRows = useMemo(() => filtered.map(tradeAsRow), [filtered]);
  const isPaperView = mode === "paper";
  const isAllView = mode === "all";

  return (
    <div className="flex flex-col gap-4 px-1 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--color-fg)]">Performance</h2>
          <p className="text-[11px] text-[var(--color-fg-dim)]">
            All-time log — persists across sessions, wallet changes, and page reloads
          </p>
        </div>
        {persistedBotTrades.length > 0 ? (
          confirmClear ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/25"
                onClick={() => { clearPersistedTrades(); setConfirmClear(false); }}
              >
                Confirm clear
              </button>
              <button
                type="button"
                className="rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-fg-dim)] hover:border-red-500/40 hover:text-red-300"
              onClick={() => setConfirmClear(true)}
            >
              Clear history
            </button>
          )
        ) : null}
      </div>

      {persistedBotTrades.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-8 text-center" style={{ background: "var(--color-fill)" }}>
          <p className="text-[13px] text-[var(--color-fg-dim)]">No trades logged yet.</p>
          <p className="mt-1 text-[11px] text-[var(--color-fg-dim)]">
            Start a trading session on the Dashboard — every closed trade (paper or real) is saved here automatically.
          </p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Real trades"
              value={String(chainTrades.length)}
              sub={chainTrades.length > 0 ? `Win rate ${chainWinRate != null ? chainWinRate.toFixed(1) + "%" : "—"}` : undefined}
            />
            <StatCard
              label="Real net SOL"
              value={chainTrades.length > 0 ? (chainNetSol >= 0 ? "+" : "") + formatSol(chainNetSol) : "—"}
              positive={chainTrades.length > 0 ? chainNetSol >= 0 : undefined}
            />
            <StatCard
              label="Paper trades"
              value={String(paperTrades.length)}
              sub={paperTrades.length > 0 ? `Win rate ${paperWinRate != null ? paperWinRate.toFixed(1) + "%" : "—"}` : undefined}
            />
            <StatCard
              label="Paper MC Δ sum"
              value={paperTrades.length > 0 ? (paperMcSum >= 0 ? "+" : "") + paperMcSum.toFixed(2) + "%" : "—"}
              sub={paperEstLegs.length > 0 ? `Est. SOL ${(paperEstNet >= 0 ? "+" : "") + formatSol(paperEstNet)}` : undefined}
              positive={paperTrades.length > 0 ? paperMcSum >= 0 : undefined}
            />
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-3 text-[11px] text-[var(--color-fg-dim)]">
            <span>{wallets.length} wallet{wallets.length !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{mints.length} token{mints.length !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{persistedBotTrades.length} total trades</span>
          </div>

          {/* Mode filter */}
          <div className="flex gap-1.5">
            {(["all", "real", "paper"] as ModeFilter[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  "rounded-lg border px-3 py-1 text-[11px] font-medium capitalize transition-colors " +
                  (mode === m
                    ? "border-[color-mix(in_srgb,#2EA8FF_40%,transparent)] bg-[color-mix(in_srgb,#2EA8FF_12%,transparent)] text-[#e8f4ff]"
                    : "border-[var(--color-border-subtle)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]")
                }
              >
                {m === "all" ? "All" : m === "real" ? "Real" : "Paper"}
              </button>
            ))}
          </div>

          {/* Trade log */}
          {filteredAsRows.length === 0 ? (
            <p className="text-[12px] text-[var(--color-fg-dim)]">No {mode} trades yet.</p>
          ) : (
            <BotTradesBook
              rows={filteredAsRows}
              paperMode={isPaperView || (isAllView && filteredAsRows.some((t) => t.kind === "tape"))}
            />
          )}
        </>
      )}
    </div>
  );
}

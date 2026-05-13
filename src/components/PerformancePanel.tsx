import { useEffect, useMemo, useState } from "react";
import { InlineToolbarPicker } from "@/components/InlineToolbarPicker";
import { Tooltip } from "@/components/Tooltip";
import { useApp } from "@/context/AppContext";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import { formatSol } from "@/lib/formatUsd";
import type { TradingSessionRecord } from "@/types";

function shortMint(mint: string | null): string {
  if (!mint) return "No token";
  return mint.length <= 12 ? mint : `${mint.slice(0, 5)}...${mint.slice(-5)}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function age(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function summarize(session: TradingSessionRecord | null) {
  if (!session) return { trades: 0, wins: 0, winRate: null as number | null, pnl: null as number | null, netSol: null as number | null };
  const trades = session.trades;
  const wins = trades.filter((t) => (t.pnlPct ?? t.netSol ?? 0) > 0).length;
  const pnlTrades = trades.filter((t) => t.pnlPct != null);
  const solTrades = trades.filter((t) => t.netSol != null);
  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? (wins / trades.length) * 100 : null,
    pnl: pnlTrades.length ? pnlTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) : null,
    netSol: solTrades.length ? solTrades.reduce((s, t) => s + (t.netSol ?? 0), 0) : null,
  };
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean | null }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.025)] px-3 py-2">
      <div className="unt-section-overline mb-1">{label}</div>
      <div
        className={
          "font-mono text-[13px] font-semibold tabular-nums " +
          (positive == null
            ? "text-[var(--color-fg)]"
            : positive
              ? "text-emerald-300"
              : "text-red-300/90")
        }
      >
        {value}
      </div>
    </div>
  );
}

export function PerformancePanel() {
  const { userAlgos, tradingSessions } = useApp();
  const [presetId, setPresetId] = useState(BUILTIN_SCALPER_PRESET_ID);
  const [sessionId, setSessionId] = useState("latest");

  useEffect(() => {
    if (presetId !== BUILTIN_SCALPER_PRESET_ID && !userAlgos.some((a) => a.id === presetId)) {
      setPresetId(BUILTIN_SCALPER_PRESET_ID);
      setSessionId("latest");
    }
  }, [presetId, userAlgos]);

  const presetGroups = useMemo(() => {
    const builtin = {
      heading: "Built-in",
      items: [{ value: BUILTIN_SCALPER_PRESET_ID, label: "Order-book scalper" }],
    };
    if (userAlgos.length === 0) return [builtin];
    return [
      builtin,
      { heading: "Your presets", items: userAlgos.map((a) => ({ value: a.id, label: a.name })) },
    ];
  }, [userAlgos]);

  const sessionsForPreset = useMemo(() => (
    tradingSessions
      .filter((s) => s.presetId === presetId)
      .sort((a, b) => b.createdAt - a.createdAt)
  ), [presetId, tradingSessions]);

  const sessionItems = useMemo(() => [
    { value: "latest", label: "Latest trading session" },
    ...sessionsForPreset.map((s, idx) => ({
      value: s.id,
      label: `${s.name || `Trading session ${idx + 1}`} · ${s.mode} · ${shortMint(s.mint)}`,
    })),
  ], [sessionsForPreset]);

  const selectedSession = sessionId === "latest"
    ? sessionsForPreset[0] ?? null
    : sessionsForPreset.find((s) => s.id === sessionId) ?? null;
  const stats = summarize(selectedSession);

  return (
    <div className="space-y-4">
      {/* Preset + session pickers */}
      <section className="unt-section-card space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="unt-section-title">Performance</h2>
          <Tooltip text="Loads saved trading-session records for the selected preset." side="right">
            <span className="grid size-4 cursor-help place-items-center rounded-full border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-fg-dim)]">?</span>
          </Tooltip>
        </div>

        <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-3">
          <div>
            <label className="unt-field-label" htmlFor="performance-preset-trigger">Algo preset</label>
            <InlineToolbarPicker
              id="performance-preset"
              value={presetId}
              onChange={(v) => {
                setPresetId(v || BUILTIN_SCALPER_PRESET_ID);
                setSessionId("latest");
              }}
              groups={presetGroups}
              aria-label="Select Algo preset"
            />
          </div>

          <div>
            <label className="unt-field-label" htmlFor="performance-session-trigger">Trading session</label>
            <InlineToolbarPicker
              id="performance-session"
              value={sessionId}
              onChange={setSessionId}
              items={sessionItems}
              aria-label="Select Trading session"
            />
          </div>
        </div>
      </section>

      {selectedSession ? (
        <>
          {/* Session summary */}
          <section className="unt-section-card space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="unt-section-title truncate">{selectedSession.name}</h3>
                <p className="unt-help-text mt-1">{selectedSession.mode} · {shortMint(selectedSession.mint)} · {age(selectedSession.createdAt)}</p>
              </div>
              <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">{selectedSession.status}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-[var(--color-border-subtle)] pt-3">
              <Stat label="Trades" value={String(stats.trades)} />
              <Stat
                label="Win rate"
                value={stats.winRate == null ? "-" : `${stats.winRate.toFixed(1)}%`}
                positive={stats.winRate == null ? null : stats.winRate >= 50}
              />
              <Stat
                label="PnL"
                value={pct(stats.pnl)}
                positive={stats.pnl == null ? null : stats.pnl >= 0}
              />
              <Stat
                label="Net SOL"
                value={stats.netSol == null ? "-" : `${stats.netSol >= 0 ? "+" : ""}${formatSol(stats.netSol)}`}
                positive={stats.netSol == null ? null : stats.netSol >= 0}
              />
            </div>
          </section>

          {/* Trade timeline */}
          <section className="unt-section-card space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="unt-section-title">Trade timeline</h3>
              <Tooltip text="Closed round trips saved inside this session file, newest first." side="top">
                <span className="grid size-4 cursor-help place-items-center rounded-full border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-fg-dim)]">?</span>
              </Tooltip>
            </div>
            <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
              {selectedSession.trades.length === 0 ? (
                <p className="unt-help-text">No closed trades yet.</p>
              ) : selectedSession.trades.slice().sort((a, b) => b.closedAtTs - a.closedAtTs).map((t) => {
                const isWin = (t.pnlPct ?? t.netSol ?? 0) > 0;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-[var(--color-fg)]">{t.kind} · {t.exitReason}</div>
                      <div className="unt-help-text">{age(t.closedAtTs)}</div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[12px]">
                      <div className={isWin ? "text-emerald-300" : "text-red-300/90"}>{pct(t.pnlPct)}</div>
                      <div className="unt-help-text">{t.netSol == null ? "-" : `${t.netSol >= 0 ? "+" : ""}${formatSol(t.netSol)} SOL`}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Raw session file */}
          <details className="unt-section-card">
            <summary className="unt-section-title cursor-pointer">View session file</summary>
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-black/20 p-3 text-[10px] leading-relaxed text-[var(--color-fg-muted)]">{JSON.stringify(selectedSession, null, 2)}</pre>
          </details>
        </>
      ) : (
        <section className="unt-section-card">
          <p className="unt-help-text">No saved trading sessions for this preset yet.</p>
        </section>
      )}
    </div>
  );
}

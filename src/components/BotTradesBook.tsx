import { useEffect, useMemo, useState } from "react";
import type { BotTradeRow } from "@/lib/scalperPaperEngine";
import { formatMcUsdBook } from "@/lib/formatUsd";

function formatAge(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function exitLabel(r: BotTradeRow): string {
  return r.exitReason === "take_profit" ? "TP" : "Sell";
}

export function BotTradesBook({
  rows,
  emptyHint = "No closed bot trades yet.",
}: {
  rows: BotTradeRow[];
  emptyHint?: string;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);

  if (rows.length === 0) {
    return (
      <p className="unt-callout py-6 text-center">
        {emptyHint}
      </p>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] font-[family-name:var(--font-mono)]"
      style={{ background: "var(--color-fill)" }}
    >
      <table className="w-full border-collapse text-left">
        <thead className="bg-[var(--color-bg-editor)]">
          <tr className="border-b border-[var(--color-border-subtle)] text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-dim)]">
            <th className="px-2 py-2">Age</th>
            <th className="px-2 py-2">PnL %</th>
            <th className="px-2 py-2">Entry</th>
            <th className="px-2 py-2">Exit</th>
            <th className="px-2 py-2">Out</th>
          </tr>
        </thead>
        <tbody className="text-[12px]">
          {newestFirst.map((t, i) => (
            <tr
              key={t.id}
              className={
                i % 2 === 1 ? "border-t border-[var(--color-border-subtle)] bg-black/20" : "border-t border-[var(--color-border-subtle)]"
              }
            >
              <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg-muted)]">
                {formatAge(t.closedAtTs)}
              </td>
              <td
                className={
                  "whitespace-nowrap px-2 py-1.5 font-medium " +
                  (t.pnlPct >= 0 ? "text-emerald-400" : "text-red-400")
                }
              >
                {(t.pnlPct >= 0 ? "+" : "") + t.pnlPct.toFixed(2)}%
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg)]">{formatMcUsdBook(t.entryMcUsd)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg)]">{formatMcUsdBook(t.exitMcUsd)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg-dim)]">{exitLabel(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

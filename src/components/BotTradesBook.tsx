import { useEffect, useMemo, useState } from "react";
import type { BotTradeRow, BotTradeRowChain, BotTradeRowTape } from "@/lib/scalperPaperEngine";
import { formatMcUsdBookDetail, formatSol } from "@/lib/formatUsd";

const SOLSCAN_TX = "https://solscan.io/tx/";

/** Tape MC move entry→exit (same formula as `reduceScalperPaper`). */
function mcMovePct(entryUsd: number, exitUsd: number): number {
  if (!(entryUsd > 0) || !Number.isFinite(exitUsd)) return 0;
  return ((exitUsd - entryUsd) / entryUsd) * 100;
}

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
  paperMode = false,
}: {
  rows: BotTradeRow[];
  emptyHint?: string;
  /** Paper trading: show bonding-curve SOL estimate columns (uses Live entry size from chart panel). */
  paperMode?: boolean;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);

  const variant = rows.length > 0 && rows[0]!.kind === "chain" ? "chain" : "tape";

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
          {variant === "chain" ? (
            <tr className="border-b border-[var(--color-border-subtle)] text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-dim)]">
              <th className="px-2 py-2">Age</th>
              <th className="px-2 py-2" title="Wallet SOL return vs SOL spent on the Lightning buy (parsed from each tx)">
                ROI %
              </th>
              <th className="px-2 py-2">Paid SOL</th>
              <th className="px-2 py-2">Back SOL</th>
              <th className="px-2 py-2">Net SOL</th>
              <th className="px-2 py-2">Out</th>
              <th className="px-2 py-2">Tx</th>
            </tr>
          ) : (
            <tr className="border-b border-[var(--color-border-subtle)] text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-dim)]">
              <th className="px-2 py-2">Age</th>
              <th className="px-2 py-2" title="Tape-implied MC move (signals only)">
                MC Δ%
              </th>
              <th className="px-2 py-2">Entry MC</th>
              <th className="px-2 py-2">Exit MC</th>
              {paperMode ? (
                <>
                  <th
                    className="px-2 py-2"
                    title="Pump constant-product estimate from virtual reserves on entry/exit prints (~fees)"
                  >
                    Est. ROI %
                  </th>
                  <th className="px-2 py-2">Est. net SOL</th>
                </>
              ) : null}
              <th className="px-2 py-2">Out</th>
            </tr>
          )}
        </thead>
        <tbody className="text-[12px]">
          {variant === "chain"
            ? (newestFirst.filter((t): t is BotTradeRowChain => t.kind === "chain")).map((t, i) => {
                const roi = t.roiPct;
                return (
                  <tr
                    key={t.id}
                    className={
                      i % 2 === 1 ? "border-t border-[var(--color-border-subtle)] bg-black/20" : "border-t border-[var(--color-border-subtle)]"
                    }
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg-muted)]">{formatAge(t.closedAtTs)}</td>
                    <td
                      className={
                        "whitespace-nowrap px-2 py-1.5 font-medium " +
                        (roi >= 0 ? "text-emerald-400" : "text-red-400")
                      }
                    >
                      {(roi >= 0 ? "+" : "") + roi.toFixed(2)}%
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-rose-200/90">{formatSol(t.solSpent)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-emerald-300/90">{formatSol(t.solReceived)}</td>
                    <td
                      className={
                        "whitespace-nowrap px-2 py-1.5 font-medium " +
                        (t.netSol >= 0 ? "text-emerald-400" : "text-red-400")
                      }
                    >
                      {(t.netSol >= 0 ? "+" : "") + formatSol(t.netSol)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg-dim)]">{exitLabel(t)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <div className="flex flex-col gap-0.5 text-[10px]">
                        <a
                          href={SOLSCAN_TX + encodeURIComponent(t.buySignature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2EA8FF] underline-offset-2 hover:underline"
                        >
                          Buy
                        </a>
                        <a
                          href={SOLSCAN_TX + encodeURIComponent(t.sellSignature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2EA8FF] underline-offset-2 hover:underline"
                        >
                          Sell
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })
            : (newestFirst.filter((t): t is BotTradeRowTape => t.kind === "tape")).map((t, i) => {
                const pct = mcMovePct(t.entryMcUsd, t.exitMcUsd);
                const est = t.paperSolEstimate;
                return (
                  <tr
                    key={t.id}
                    className={
                      i % 2 === 1 ? "border-t border-[var(--color-border-subtle)] bg-black/20" : "border-t border-[var(--color-border-subtle)]"
                    }
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg-muted)]">{formatAge(t.closedAtTs)}</td>
                    <td
                      className={
                        "whitespace-nowrap px-2 py-1.5 font-medium " +
                        (pct >= 0 ? "text-emerald-400" : "text-red-400")
                      }
                    >
                      {(pct >= 0 ? "+" : "") + pct.toFixed(2)}%
                    </td>
                    <td
                      className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg)]"
                      title={`$${t.entryMcUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    >
                      {formatMcUsdBookDetail(t.entryMcUsd)}
                    </td>
                    <td
                      className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg)]"
                      title={`$${t.exitMcUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    >
                      {formatMcUsdBookDetail(t.exitMcUsd)}
                    </td>
                    {paperMode ? (
                      <>
                        <td
                          className={
                            "whitespace-nowrap px-2 py-1.5 font-medium " +
                            (est
                              ? est.roiPct >= 0
                                ? "text-cyan-300/95"
                                : "text-orange-300/95"
                              : "text-[var(--color-fg-dim)]")
                          }
                          title={
                            est
                              ? "Bonding snapshot model (~fees)"
                              : "No reserves on these prints or migrated pool — can't estimate"
                          }
                        >
                          {est ? (est.roiPct >= 0 ? "+" : "") + est.roiPct.toFixed(2) + "%" : "—"}
                        </td>
                        <td
                          className={
                            "whitespace-nowrap px-2 py-1.5 " +
                            (est
                              ? est.netSol >= 0
                                ? "font-medium text-cyan-300/95"
                                : "font-medium text-orange-300/95"
                              : "text-[var(--color-fg-dim)]")
                          }
                        >
                          {est ? (est.netSol >= 0 ? "+" : "") + formatSol(est.netSol) : "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="whitespace-nowrap px-2 py-1.5 text-[var(--color-fg-dim)]">{exitLabel(t)}</td>
                  </tr>
                );
              })}
        </tbody>
      </table>
      <p className="border-t border-[var(--color-border-subtle)] px-2 py-1.5 text-[10px] leading-snug text-[var(--color-fg-dim)]">
        {variant === "chain"
          ? "ROI uses native SOL balance deltas for your Setup wallet on buy vs sell txs (includes fees). Verify on Solscan."
          : paperMode
            ? "Signals still come from tape MC. Est. SOL applies pump-style bonding math to virtual reserves on entry/exit prints (~fixed fees), using Live entry size — not a full order-flow replay; migrated tokens skip estimates."
            : "Tape-driven MC Δ% only."}
      </p>
    </div>
  );
}

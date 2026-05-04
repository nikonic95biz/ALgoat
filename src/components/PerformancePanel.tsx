import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useApp, type PersistedBotTrade } from "@/context/AppContext";
import { formatMcUsdBookDetail, formatSol } from "@/lib/formatUsd";
import type { BotTradeRowChain, BotTradeRowTape } from "@/lib/scalperPaperEngine";

type ModeFilter = "all" | "real" | "paper";

const SOLSCAN_TX = "https://solscan.io/tx/";
const SOLSCAN_TOKEN = "https://solscan.io/token/";
const PUMP_COIN = "https://pump.fun/coin/";

function StatCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5"
      style={{ background: "var(--color-fill)" }}
    >
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">{label}</span>
      <span
        className={
          "text-[15px] font-semibold tabular-nums " +
          (positive === true ? "text-emerald-300" : positive === false ? "text-red-400" : "text-[var(--color-fg)]")
        }
      >
        {value}
      </span>
      {sub ? <span className="text-[10px] text-[var(--color-fg-dim)]">{sub}</span> : null}
    </div>
  );
}

function formatAge(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function mcMovePct(entryUsd: number, exitUsd: number): number {
  if (!(entryUsd > 0) || !Number.isFinite(exitUsd)) return 0;
  return ((exitUsd - entryUsd) / entryUsd) * 100;
}

function shortenPk(pk: string): string {
  const t = pk.trim();
  if (t.length <= 12) return t;
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function shortenMint(mint: string): string {
  const t = mint.trim();
  if (t.length <= 16) return t;
  return `${t.slice(0, 6)}…${t.slice(-6)}`;
}

function exitLabel(r: BotTradeRowTape | BotTradeRowChain): string {
  return r.exitReason === "take_profit" ? "TP" : "Sell";
}

function copyWalletPk(pk: string) {
  void navigator.clipboard.writeText(pk).catch(() => {});
}

function PersistedTradesTable({ trades }: { trades: PersistedBotTrade[] }) {
  const sorted = useMemo(() => [...trades].sort((a, b) => b.closedAtTs - a.closedAtTs), [trades]);
  const [, setTick] = useState(0);
  const [mintCopiedForId, setMintCopiedForId] = useState<string | null>(null);
  const mintCopiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (mintCopiedTimerRef.current != null) window.clearTimeout(mintCopiedTimerRef.current);
    };
  }, []);

  const handleCopyMint = useCallback((tradeId: string, mint: string) => {
    void navigator.clipboard.writeText(mint).catch(() => {});
    if (mintCopiedTimerRef.current != null) window.clearTimeout(mintCopiedTimerRef.current);
    setMintCopiedForId(tradeId);
    mintCopiedTimerRef.current = window.setTimeout(() => {
      setMintCopiedForId(null);
      mintCopiedTimerRef.current = null;
    }, 1000);
  }, []);

  return (
    <div
      className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] font-[family-name:var(--font-mono)]"
      style={{ background: "var(--color-fill)" }}
    >
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead className="bg-[var(--color-bg-editor)]">
          <tr className="border-b border-[var(--color-border-subtle)] text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-dim)]">
            <th className="whitespace-nowrap px-2 py-2">When</th>
            <th className="whitespace-nowrap px-2 py-2">Mode</th>
            <th className="min-w-[140px] whitespace-nowrap px-2 py-2">Token (mint)</th>
            <th className="whitespace-nowrap px-2 py-2">Wallet</th>
            <th className="whitespace-nowrap px-2 py-2">Outcome</th>
            <th className="whitespace-nowrap px-2 py-2">Levels</th>
            <th className="whitespace-nowrap px-2 py-2" title="Paper bonding estimate only">
              Est.
            </th>
            <th className="whitespace-nowrap px-2 py-2">Out</th>
            <th className="whitespace-nowrap px-2 py-2">Links</th>
          </tr>
        </thead>
        <tbody className="text-[11px]">
          {sorted.map((t, i) => {
            const win =
              t.kind === "chain"
                ? t.netSol > 0
                : mcMovePct(t.entryMcUsd, t.exitMcUsd) > 0;
            const rowTint =
              win ? "bg-emerald-500/[0.03]" : "bg-red-500/[0.03]";
            const iso = new Date(t.closedAtTs).toISOString();

            return (
              <tr
                key={t.id}
                className={
                  (i % 2 === 1 ? "border-t border-[var(--color-border-subtle)] " : "border-t border-[var(--color-border-subtle)] ") +
                  rowTint
                }
              >
                <td className="whitespace-nowrap px-2 py-1.5 align-top text-[var(--color-fg-muted)]" title={iso}>
                  {formatAge(t.closedAtTs)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 align-top">
                  {t.kind === "chain" ? (
                    <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-200/90">
                      Real
                    </span>
                  ) : (
                    <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-300/90">
                      Paper
                    </span>
                  )}
                </td>
                <td className="max-w-[200px] px-2 py-1.5 align-top">
                  <div className="flex flex-col gap-1">
                    <span className="truncate font-mono text-[10px] text-[var(--color-fg)]" title={t.mint}>
                      {shortenMint(t.mint)}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        title="Copy mint"
                        onClick={() => handleCopyMint(t.id, t.mint)}
                        className={
                          "inline-flex min-w-[52px] items-center justify-center gap-0.5 rounded border px-1 py-px text-[9px] transition-colors " +
                          (mintCopiedForId === t.id
                            ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-300/95"
                            : "border-[var(--color-border-subtle)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg-muted)]")
                        }
                      >
                        {mintCopiedForId === t.id ? (
                          <Check className="size-2.5" strokeWidth={2} />
                        ) : (
                          <Copy className="size-2.5" strokeWidth={2} />
                        )}
                        {mintCopiedForId === t.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                </td>
                <td
                  className="whitespace-nowrap px-2 py-1.5 align-top font-mono text-[10px] text-[var(--color-fg-muted)]"
                  title={t.walletPk}
                >
                  <button
                    type="button"
                    onClick={() => copyWalletPk(t.walletPk)}
                    className="hover:text-[var(--color-fg)]"
                    title="Copy wallet"
                  >
                    {shortenPk(t.walletPk)}
                  </button>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 align-top">
                  {t.kind === "chain" ? (
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={
                          "font-semibold " + (t.roiPct >= 0 ? "text-emerald-400" : "text-red-400")
                        }
                      >
                        {(t.roiPct >= 0 ? "+" : "") + t.roiPct.toFixed(2)}% ROI
                      </span>
                      <span
                        className={
                          "text-[10px] font-medium " +
                          (t.netSol >= 0 ? "text-emerald-400/90" : "text-red-400/90")
                        }
                      >
                        {(t.netSol >= 0 ? "+" : "") + formatSol(t.netSol)} SOL net
                      </span>
                    </div>
                  ) : (
                    (() => {
                      const pct = mcMovePct(t.entryMcUsd, t.exitMcUsd);
                      return (
                        <span
                          className={
                            "font-semibold " + (pct >= 0 ? "text-emerald-400" : "text-red-400")
                          }
                        >
                          {(pct >= 0 ? "+" : "") + pct.toFixed(2)}% MC
                        </span>
                      );
                    })()
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 align-top text-[var(--color-fg)]">
                  {t.kind === "chain" ? (
                    <div className="flex flex-col gap-0.5 text-[10px]" title="SOL spent on buy → SOL received on sell">
                      <span className="text-rose-200/85">{formatSol(t.solSpent)} →</span>
                      <span className="text-emerald-300/85">{formatSol(t.solReceived)}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5 text-[10px]" title="Tape MC at entry vs exit">
                      <span>{formatMcUsdBookDetail(t.entryMcUsd)}</span>
                      <span className="text-[var(--color-fg-muted)]">↓</span>
                      <span>{formatMcUsdBookDetail(t.exitMcUsd)}</span>
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 align-top text-[10px]">
                  {t.kind === "tape" && t.paperSolEstimate ? (
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={
                          t.paperSolEstimate.roiPct >= 0 ? "text-cyan-300/90" : "text-orange-300/90"
                        }
                      >
                        {(t.paperSolEstimate.roiPct >= 0 ? "+" : "") +
                          t.paperSolEstimate.roiPct.toFixed(1)}
                        % roi
                      </span>
                      <span
                        className={
                          t.paperSolEstimate.netSol >= 0 ? "text-cyan-300/90" : "text-orange-300/90"
                        }
                      >
                        {(t.paperSolEstimate.netSol >= 0 ? "+" : "") +
                          formatSol(t.paperSolEstimate.netSol)}{" "}
                        SOL
                      </span>
                    </div>
                  ) : t.kind === "tape" ? (
                    <span className="text-[var(--color-fg-dim)]" title="No bonding reserves on prints — migrated or thin tape">
                      —
                    </span>
                  ) : (
                    <span className="text-[var(--color-fg-dim)]">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 align-top text-[var(--color-fg-dim)]">
                  {exitLabel(t)}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 align-top">
                  <div className="flex flex-wrap gap-1">
                    <a
                      href={SOLSCAN_TOKEN + encodeURIComponent(t.mint)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Solscan token"
                      className="inline-flex items-center gap-0.5 rounded border border-[var(--color-border-subtle)] px-1 py-px text-[9px] text-[#2EA8FF] hover:border-[color-mix(in_srgb,#2EA8FF_40%,transparent)]"
                    >
                      <ExternalLink className="size-2.5" strokeWidth={2} />
                      Solscan
                    </a>
                    <a
                      href={PUMP_COIN + encodeURIComponent(t.mint)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Pump.fun"
                      className="inline-flex items-center gap-0.5 rounded border border-[var(--color-border-subtle)] px-1 py-px text-[9px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                    >
                      <ExternalLink className="size-2.5" strokeWidth={2} />
                      Pump
                    </a>
                    {t.kind === "chain" ? (
                      <>
                        <a
                          href={SOLSCAN_TX + encodeURIComponent(t.buySignature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[9px] text-[#2EA8FF] underline-offset-2 hover:underline"
                        >
                          Buy tx
                        </a>
                        <a
                          href={SOLSCAN_TX + encodeURIComponent(t.sellSignature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[9px] text-[#2EA8FF] underline-offset-2 hover:underline"
                        >
                          Sell tx
                        </a>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-[var(--color-border-subtle)] px-2 py-1.5 text-[10px] leading-snug text-[var(--color-fg-dim)]">
        <span className="text-[var(--color-fg-muted)]">Real:</span> ROI / net SOL from wallet balance deltas on PumpPortal buy+sell txs (includes fees).{" "}
        <span className="text-[var(--color-fg-muted)]">Paper:</span> MC Δ% from tape; Est. columns use bonding-curve math when virtual reserves exist — skipped after migration or missing prints.
      </p>
    </div>
  );
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

  const chainTrades = useMemo(() => persistedBotTrades.filter((t) => t.kind === "chain"), [persistedBotTrades]);
  const paperTrades = useMemo(() => persistedBotTrades.filter((t) => t.kind === "tape"), [persistedBotTrades]);

  const chainNetSol = chainTrades.reduce((s, t) => s + (t.kind === "chain" ? t.netSol : 0), 0);
  const chainWins = chainTrades.filter((t) => t.kind === "chain" && t.netSol > 0).length;
  const chainWinRate = chainTrades.length > 0 ? (chainWins / chainTrades.length) * 100 : null;

  const paperWins = paperTrades.filter((t) => t.kind === "tape" && t.pnlPct > 0).length;
  const paperWinRate = paperTrades.length > 0 ? (paperWins / paperTrades.length) * 100 : null;
  const paperMcSum = paperTrades.reduce((s, t) => s + (t.kind === "tape" ? t.pnlPct : 0), 0);
  const paperEstLegs = paperTrades.filter((t) => t.kind === "tape" && t.paperSolEstimate != null);
  const paperEstNet = paperEstLegs.reduce(
    (s, t) => s + (t.kind === "tape" && t.paperSolEstimate ? t.paperSolEstimate.netSol : 0),
    0,
  );

  const wallets = useMemo(() => [...new Set(persistedBotTrades.map((t) => t.walletPk))], [persistedBotTrades]);
  const mints = useMemo(() => [...new Set(persistedBotTrades.map((t) => t.mint))], [persistedBotTrades]);

  return (
    <div className="flex flex-col gap-4 px-1 pb-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--color-fg)]">Performance</h2>
          <p className="text-[11px] text-[var(--color-fg-dim)]">
            Closed trades only — saved per mint + wallet.
          </p>
        </div>
        {persistedBotTrades.length > 0 ? (
          confirmClear ? (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded-md border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/25"
                onClick={() => {
                  clearPersistedTrades();
                  setConfirmClear(false);
                }}
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
              className="shrink-0 rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-fg-dim)] hover:border-red-500/40 hover:text-red-300"
              onClick={() => setConfirmClear(true)}
            >
              Clear history
            </button>
          )
        ) : null}
      </div>

      {persistedBotTrades.length === 0 ? (
        <div
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-8 text-center"
          style={{ background: "var(--color-fill)" }}
        >
          <p className="text-[13px] text-[var(--color-fg-dim)]">No trades logged yet.</p>
          <p className="mt-1 text-[11px] text-[var(--color-fg-dim)]">
            Run a session on the Dashboard — each closed round-trip (paper or real) is appended here with mint + wallet.
          </p>
        </div>
      ) : (
        <>
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
              sub={
                paperEstLegs.length > 0
                  ? `Est. SOL ${(paperEstNet >= 0 ? "+" : "") + formatSol(paperEstNet)} (${paperEstLegs.length} w/ est.)`
                  : undefined
              }
              positive={paperTrades.length > 0 ? paperMcSum >= 0 : undefined}
            />
          </div>

          <div className="flex flex-wrap gap-3 text-[11px] text-[var(--color-fg-dim)]">
            <span>{wallets.length} wallet{wallets.length !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{mints.length} token{mints.length !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{persistedBotTrades.length} total trades</span>
          </div>

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

          {filtered.length === 0 ? (
            <p className="text-[12px] text-[var(--color-fg-dim)]">No {mode} trades yet.</p>
          ) : (
            <PersistedTradesTable trades={filtered} />
          )}
        </>
      )}
    </div>
  );
}

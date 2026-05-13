import { useState, useEffect, useMemo } from "react";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";
import { usePumpPortalLinkedWalletSol } from "@/hooks/usePumpPortalLinkedWalletSol";
import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";
import { formatMcUsdBook, formatSol } from "@/lib/formatUsd";
import {
  getEffectivePumpPortalApiKey,
  getStoredPumpPortalApiKey,
  setStoredPumpPortalApiKey,
  getStoredPumpPortalTradingWalletSecret,
  setStoredPumpPortalTradingWalletSecret,
  getPumpPortalWsMode,
  PUMPPORTAL_MIN_LINKED_WALLET_SOL,
  isPumpPortalLinkedWalletFunded,
} from "@/lib/pumpPortalConfig";
import { tryPubkeyFromSolanaWalletSecret } from "@/lib/solanaWalletSecret";
import { refreshPumpPortalSocket } from "@/lib/pumpPortalRealtime";

type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

const frame =
  "rounded-xl border border-cyan-400/25 bg-gradient-to-b from-[#12122a]/95 via-[#0c0c18] to-[#06060f] shadow-[0_0_0_1px_rgba(168,85,247,0.08),inset_0_1px_0_0_rgba(34,211,238,0.06)]";

function fmtPrintTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-300/50">{label}</label>
      {children}
    </div>
  );
}

function InputField({
  value, onChange, placeholder, type = "password", onEnter,
}: {
  value: string; onChange: (v: string) => void; placeholder: string; type?: string; onEnter?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }}
      placeholder={placeholder}
      className="w-full rounded-lg border border-cyan-400/18 bg-[rgba(34,211,238,0.04)] px-3 py-2 font-mono text-[11px] text-cyan-100/80 outline-none placeholder:text-violet-300/22 focus:border-cyan-400/35 transition-colors"
    />
  );
}

/** Lock screen shown when no PumpPortal API key is set */
function OrderBookLock({ onUnlock }: { onUnlock: () => void }) {
  const [apiKey, setApiKey] = useState(getStoredPumpPortalApiKey());
  const [walletSecret, setWalletSecret] = useState(getStoredPumpPortalTradingWalletSecret());
  const [saving, setSaving] = useState(false);

  const walletPubkey = useMemo(() => tryPubkeyFromSolanaWalletSecret(walletSecret), [walletSecret]);
  const { sol: walletSol, loading: walletSolLoading } = usePumpPortalLinkedWalletSol(walletPubkey);

  function handleSave() {
    const trimKey = apiKey.trim();
    if (!trimKey) return;
    setSaving(true);
    setStoredPumpPortalApiKey(trimKey);
    if (walletSecret.trim()) setStoredPumpPortalTradingWalletSecret(walletSecret.trim());
    refreshPumpPortalSocket();
    setTimeout(() => { setSaving(false); onUnlock(); }, 300);
  }

  const funded = walletPubkey && walletSol !== null ? isPumpPortalLinkedWalletFunded(walletSol ?? 0) : null;

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 py-5 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-500/8">
          <svg className="h-4 w-4 text-cyan-300/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V7a4.5 4.5 0 00-9 0v3.5M5 10.5h14a1 1 0 011 1V20a1 1 0 01-1 1H5a1 1 0 01-1-1v-8.5a1 1 0 011-1z" />
          </svg>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-[rgba(255,255,255,0.8)]">Connect PumpPortal</p>
          <p className="text-[11px] text-violet-300/45">Required for live trade data</p>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        <Field label="API key">
          <InputField value={apiKey} onChange={setApiKey} placeholder="Paste your PumpPortal key…" onEnter={handleSave} />
          <a href="https://pumpportal.fun/trading-api/setup" target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-cyan-400/40 hover:text-cyan-400/70 transition-colors">
            Get key at pumpportal.fun ↗
          </a>
        </Field>

        <Field label="Trading wallet private key">
          <InputField value={walletSecret} onChange={setWalletSecret} placeholder="Base58 or array private key…" />
          {walletPubkey && (
            <div className="flex items-center justify-between rounded-md border border-cyan-400/15 bg-cyan-500/5 px-2.5 py-1.5 mt-1">
              <span className="font-mono text-[10px] text-cyan-300/60 truncate">{walletPubkey.slice(0, 8)}…{walletPubkey.slice(-6)}</span>
              {walletSolLoading ? (
                <span className="text-[10px] text-violet-300/40">…</span>
              ) : walletSol !== null ? (
                <span className={`text-[10px] font-semibold ${funded ? "text-emerald-400/80" : "text-amber-400/80"}`}>
                  {walletSol.toFixed(3)} SOL
                </span>
              ) : null}
            </div>
          )}
        </Field>

        {/* 0.02 SOL note */}
        <div className="flex gap-2 rounded-lg border border-amber-400/22 bg-amber-500/6 px-3 py-2">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-[11px] leading-snug text-amber-200/65">
            Keep <span className="font-semibold text-amber-200/90">{PUMPPORTAL_MIN_LINKED_WALLET_SOL} SOL</span> in the linked wallet to receive live trades.
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={!apiKey.trim() || saving}
        onClick={handleSave}
        className="w-full rounded-xl border border-cyan-400/28 bg-cyan-500/12 py-2.5 text-[13px] font-semibold text-cyan-200 transition-all hover:bg-cyan-500/20 disabled:opacity-35"
      >
        {saving ? "Connecting…" : "Unlock order book"}
      </button>
    </div>
  );
}

/** View when wallet has insufficient funds */
function InsufficientFundsView() {
  const [editOpen, setEditOpen] = useState(false);
  const [apiKey, setApiKey] = useState(getStoredPumpPortalApiKey());

  function save() {
    setStoredPumpPortalApiKey(apiKey.trim());
    refreshPumpPortalSocket();
    setEditOpen(false);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-400/25 bg-amber-500/8">
        <svg className="h-4.5 w-4.5 text-amber-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
        </svg>
      </div>
      <div>
        <p className="text-[13px] font-semibold text-amber-200/80">Add 0.02 SOL to unlock</p>
        <p className="mt-1 text-[11px] leading-snug text-violet-300/45">
          Top up your PumpPortal linked wallet to{" "}
          <span className="font-medium text-amber-200/70">{PUMPPORTAL_MIN_LINKED_WALLET_SOL} SOL</span>{" "}
          to receive live trade streams.
        </p>
      </div>
      {editOpen && (
        <div className="w-full max-w-xs space-y-2 rounded-lg border border-cyan-400/18 bg-cyan-500/5 p-3">
          <p className="text-[10px] text-violet-300/50">PumpPortal API key</p>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-md border border-cyan-400/18 bg-transparent px-2.5 py-1.5 font-mono text-[11px] text-cyan-100/70 outline-none"
          />
          <button type="button" onClick={save} className="w-full rounded-md bg-cyan-500/15 py-1.5 text-[12px] text-cyan-300">Save</button>
        </div>
      )}
      <button type="button" onClick={() => setEditOpen((o) => !o)} className="text-[11px] text-violet-300/35 underline hover:text-violet-300/60">
        {editOpen ? "Cancel" : "Edit API key"}
      </button>
    </div>
  );
}

function ApiKeyPopover({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState(getStoredPumpPortalApiKey());
  function save() {
    setStoredPumpPortalApiKey(draft.trim());
    refreshPumpPortalSocket();
    onClose();
  }
  return (
    <div
      className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl p-3 shadow-2xl"
      style={{ background: "#0d0d1f", border: "1px solid rgba(34,211,238,0.2)" }}
    >
      <p className="mb-1 text-[11px] font-semibold text-[rgba(255,255,255,0.8)]">PumpPortal API key</p>
      <p className="mb-2 text-[10px] leading-snug text-violet-300/45">
        Required to receive live trade fills.{" "}
        <a href="https://pumpportal.fun/trading-api/setup" target="_blank" rel="noopener noreferrer" className="text-cyan-400/60 hover:text-cyan-400">
          Get key ↗
        </a>
      </p>
      <input
        autoFocus
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
        placeholder="Paste key…"
        className="mb-2 w-full rounded-lg border border-cyan-400/20 bg-[rgba(34,211,238,0.05)] px-2.5 py-1.5 font-mono text-[11px] text-cyan-100/80 outline-none placeholder:text-violet-300/25"
      />
      <div className="flex gap-1.5">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg py-1.5 text-[11px] text-violet-300/50 hover:text-violet-300/80">Cancel</button>
        <button type="button" onClick={save} className="flex-1 rounded-lg bg-cyan-500/15 py-1.5 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/22">Save</button>
      </div>
    </div>
  );
}

function OrderBookHeader({ badge, showApiBtn }: { badge?: string; showApiBtn?: boolean }) {
  const [apiOpen, setApiOpen] = useState(false);
  return (
    <div className="relative flex shrink-0 items-center justify-between gap-2 border-b border-cyan-400/15 px-3 py-2">
      <div>
        <div className="bg-gradient-to-r from-teal-200 via-cyan-200 to-violet-200 bg-clip-text text-[15px] font-semibold tracking-tight text-transparent">
          Order book
        </div>
        <p className="mt-0.5 text-[11px] text-violet-200/40">PumpPortal trades</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {showApiBtn && (
          <div className="relative">
            <button
              type="button"
              title="Edit PumpPortal API key"
              onClick={() => setApiOpen((o) => !o)}
              className="flex items-center gap-1 rounded-md border border-violet-400/20 bg-violet-500/8 px-2 py-1 text-[10px] text-violet-300/55 transition-colors hover:border-cyan-400/30 hover:text-cyan-300/80"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
              API
            </button>
            {apiOpen && <ApiKeyPopover onClose={() => setApiOpen(false)} />}
          </div>
        )}
        {badge && (
          <span className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide ${
            badge === "LIVE" ? "border-teal-400/30 bg-teal-500/10 text-teal-200/90"
            : "border-violet-400/20 bg-violet-500/10 text-violet-300/60"
          }`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

export function PumpOrderBook({
  rows,
  state,
  error,
  mint,
  yMcCap: _yMcCap,
}: {
  rows: PumpPortalLiveRow[];
  state: ConnState;
  error: string | null;
  mint: string | null;
  yMcCap: boolean;
}) {
  void _yMcCap;

  const rev = usePumpPortalConfigRevision();
  const wsMode = getPumpPortalWsMode();

  // Wallet balance check (for "add 0.02 SOL" state)
  const walletPubkey = useMemo(() => tryPubkeyFromSolanaWalletSecret(getStoredPumpPortalTradingWalletSecret()), [rev]);
  const { sol: walletSol } = usePumpPortalLinkedWalletSol(walletPubkey);
  const walletFunded = walletPubkey && walletSol !== null ? isPumpPortalLinkedWalletFunded(walletSol ?? 0) : true;

  const [unlocked, setUnlocked] = useState(() => Boolean(getEffectivePumpPortalApiKey()));
  useEffect(() => {
    setUnlocked(Boolean(getEffectivePumpPortalApiKey()));
  }, [rev]);

  const statusText =
    state === "open" ? "LIVE"
    : state === "connecting" ? "CONN"
    : state === "closed" ? "RECONN"
    : state === "error" ? "ERR"
    : "OFF";

  // State: locked (no API key)
  if (!unlocked) {
    return (
      <div className={`flex min-h-[220px] min-w-0 flex-1 flex-col overflow-hidden ${frame}`}>
        <OrderBookHeader badge="LOCKED" />
        <OrderBookLock onUnlock={() => setUnlocked(true)} />
      </div>
    );
  }

  // State: no CA selected
  if (!mint) {
    return (
      <div className={`flex min-h-[220px] min-w-0 flex-1 flex-col overflow-hidden ${frame}`}>
        <OrderBookHeader badge="OFF" showApiBtn />
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
          <p className="text-[13px] font-medium text-violet-200/50">Select a CA to start</p>
          <p className="text-[11px] text-violet-300/28">Paste a contract address in the chart above</p>
        </div>
      </div>
    );
  }

  // State: wallet not funded
  if (!walletFunded) {
    return (
      <div className={`flex min-h-[220px] min-w-0 flex-1 flex-col overflow-hidden ${frame}`}>
        <OrderBookHeader badge="OFF" showApiBtn />
        <InsufficientFundsView />
      </div>
    );
  }

  // Main unlocked live view
  return (
    <div className={`flex min-h-[220px] min-w-0 flex-1 flex-col overflow-hidden ${frame}`}>
      <OrderBookHeader badge={statusText} showApiBtn />

      {error ? (
        <div className="shrink-0 px-3 py-2 text-[13px] text-red-300/95">{error}</div>
      ) : null}

      {state === "open" && rows.length === 0 && !error && wsMode === "anonymous" ? (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/85">
          Connected — PumpPortal may need an API key for this token's trades.
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-[#0a0a14]/90 px-2 py-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/55">
            Prints ({rows.length})
          </div>
          <div className="max-h-[min(50vh,420px)] min-h-[160px] space-y-0.5 overflow-y-auto font-mono text-[11px]">
            {rows.slice(0, 120).map((r) => (
              <div key={r.id} className="flex justify-between gap-2 border-b border-white/[0.04] py-0.5 text-violet-200/90">
                <span className="shrink-0 text-violet-400/60">{fmtPrintTime(r.ts)}</span>
                <span className={r.buy ? "text-emerald-300" : "text-rose-300"}>{r.buy ? "Buy" : "Sell"}</span>
                <span className="text-cyan-100/80">{formatSol(r.sol)}</span>
                <span className="shrink-0 text-right text-violet-300/75">{r.mcUsd != null ? formatMcUsdBook(r.mcUsd) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : state === "open" && !error ? (
        <div className="flex min-h-[160px] flex-1 items-center justify-center px-3 py-6 text-center text-[11px] text-violet-300/40">
          Waiting for trades on this mint…
        </div>
      ) : null}
    </div>
  );
}

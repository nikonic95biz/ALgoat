import { useEffect, useRef, useState } from "react";
import { getSolUsd } from "@/lib/solUsd";
import {
  subscribePumpPortalServerErrors,
  subscribePumpPortalSocketState,
  subscribePumpPortalTokenTrades,
} from "@/lib/pumpPortalRealtime";

export type PumpPortalLiveRow = {
  id: string;
  ts: number;
  buy: boolean;
  sol: number;
  mcUsd: number | null;
  /** Normalized token amount for display (UI units when possible). */
  tokenAmount: number | null;
  trader: string | null;
};

type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

function parseSide(msg: Record<string, unknown>): boolean | null {
  if (typeof msg.isBuy === "boolean") return msg.isBuy;
  if (typeof msg.is_buy === "boolean") return msg.is_buy;
  if (typeof msg.isBuy === "number" && Number.isFinite(msg.isBuy)) return msg.isBuy !== 0;
  if (typeof msg.is_buy === "number" && Number.isFinite(msg.is_buy)) return msg.is_buy !== 0;
  const tx = String(msg.txType ?? "").toLowerCase();
  if (tx === "buy") return true;
  if (tx === "sell") return false;
  if (tx === "create") return true;
  const side = String(msg.side ?? "").toLowerCase();
  if (side === "buy" || side === "bid" || side === "b") return true;
  if (side === "sell" || side === "ask" || side === "s") return false;
  const a = String(msg.action ?? "").toLowerCase();
  if (a === "buy" || a === "b") return true;
  if (a === "sell" || a === "s") return false;
  const ty = String(msg.type ?? "").toLowerCase();
  if (ty === "buy") return true;
  if (ty === "sell") return false;
  const ev = String(msg.event ?? "").toLowerCase();
  if (ev === "buy" || ev === "purchase") return true;
  if (ev === "sell") return false;
  return null;
}

function parseNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pickStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function tradeMint(msg: Record<string, unknown>): string | null {
  const m =
    pickStr(msg.mint) ??
    pickStr(msg.coin) ??
    pickStr(msg.tokenMint) ??
    pickStr(msg.tokenAddress) ??
    pickStr(msg.baseMint);
  if (m) return m;
  const token = msg.token;
  if (token && typeof token === "object") {
    const o = token as Record<string, unknown>;
    return pickStr(o.mint) ?? pickStr(o.address);
  }
  const pool = msg.pool;
  if (pool && typeof pool === "object") {
    const o = pool as Record<string, unknown>;
    const pm = pickStr(o.mint) ?? pickStr(o.tokenMint) ?? pickStr(o.baseMint);
    if (pm) return pm;
  }
  return null;
}

function flattenIncoming(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((x) => flattenIncoming(x));
  }
  if (typeof raw !== "object") return [];
  const msg = raw as Record<string, unknown>;
  const inner = msg.data ?? msg.payload ?? msg.trade;
  if (Array.isArray(inner)) {
    return inner.flatMap((x) => flattenIncoming(x));
  }
  if (inner && typeof inner === "object") {
    return [{ ...msg, ...(inner as Record<string, unknown>) }];
  }

  const p = msg.params;
  if (p != null && typeof p === "object") {
    if (Array.isArray(p)) {
      return p.flatMap((x) => flattenIncoming(x));
    }
    return [{ ...msg, ...(p as Record<string, unknown>) }];
  }

  const r = msg.result;
  if (r != null && typeof r === "object" && !Array.isArray(r)) {
    return [{ ...msg, ...(r as Record<string, unknown>) }];
  }

  return [msg];
}

function normalizeTokenAmount(raw: number): number | null {
  if (!Number.isFinite(raw) || raw === 0) return null;
  let v = raw;
  if (v > 1e18) v /= 1e6;
  else if (v > 1e15) v /= 1e6;
  return v;
}

function parseTokenAmount(msg: Record<string, unknown>): number | null {
  const raw = parseNum(msg.tokenAmount);
  if (raw !== 0) return normalizeTokenAmount(raw);
  const alt = parseNum(msg.amount);
  if (alt !== 0) return normalizeTokenAmount(alt);
  return null;
}

function eventTimestamp(msg: Record<string, unknown>): number {
  const t = msg.timestamp;
  if (typeof t === "number" && t > 1e12) return t;
  if (typeof t === "number" && t > 1e9) return t * 1000;
  const bt = msg.blockTime;
  if (typeof bt === "number" && bt > 1e9) return bt * 1000;
  return Date.now();
}

function parseSolNotional(msg: Record<string, unknown>): number {
  const lam = parseNum(msg.lamports);
  if (lam > 500) return lam / 1e9;
  return (
    parseNum(msg.solAmount) ||
    parseNum(msg.sol) ||
    parseNum(msg.amountSol) ||
    parseNum(msg.qtySol) ||
    parseNum(msg.solIn) ||
    parseNum(msg.quoteAmountInSol) ||
    parseNum(msg.quoteInSol) ||
    parseNum(msg.spentSOL) ||
    parseNum(msg.volumeSol)
  );
}

function parseMcUsd(msg: Record<string, unknown>, solUsd: number): number | null {
  const usdKeys =
    "marketCapUsd|usdMarketCap|marketCapUSD|mcUsd|bondingCurveMarketCapUsd|market_cap_usd|mc_usd".split(
      "|",
    ) as readonly string[];
  for (const key of usdKeys) {
    const n = parseNum(msg[key]);
    if (n > 0) return n;
  }
  const mcSol = parseNum(
    msg.marketCapSol ?? msg.vSolInBondingCurve ?? msg.bondingCurveMarketCapSol,
  );
  if (mcSol > 0 && solUsd > 0) return mcSol * solUsd;
  return null;
}

function parseTrader(msg: Record<string, unknown>): string | null {
  return (
    pickStr(msg.traderPublicKey) ??
    pickStr(msg.trader) ??
    pickStr(msg.user) ??
    pickStr(msg.userAddress) ??
    pickStr(msg.wallet) ??
    pickStr(msg.buyer) ??
    pickStr(msg.seller)
  );
}

export function usePumpPortalTrades(mint: string | null, maxRows = 80) {
  const [rows, setRows] = useState<PumpPortalLiveRow[]>([]);
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const solUsdRef = useRef(150);
  const synthSeqRef = useRef(0);

  const mintKey = mint?.trim() || null;

  useEffect(() => {
    void getSolUsd().then((v) => {
      solUsdRef.current = v;
    });
  }, []);

  useEffect(() => {
    const solTick = window.setInterval(() => {
      void getSolUsd().then((v) => {
        solUsdRef.current = v;
      });
    }, 60_000);
    return () => clearInterval(solTick);
  }, []);

  useEffect(() => {
    setRows([]);
    setError(null);
    synthSeqRef.current = 0;
    if (!mintKey) {
      setState("idle");
      return;
    }

    setState("connecting");

    const unsubConn = subscribePumpPortalSocketState((open) => {
      setState(open ? "open" : "connecting");
      if (open) setError(null);
    });

    const unsubSrv = subscribePumpPortalServerErrors((msg) => {
      setError(msg);
    });

    const unsubTrade = subscribePumpPortalTokenTrades(mintKey, (msg) => {
      const solUsd = solUsdRef.current;
      for (const m of flattenIncoming(msg)) {
        const mintFromMsg = tradeMint(m);
        if (mintFromMsg == null || mintFromMsg !== mintKey) continue;

        const side = parseSide(m);
        if (side === null) continue;

        const sol = parseSolNotional(m);
        const mcUsd = parseMcUsd(m, solUsd);

        const sig =
          pickStr(m.signature) ??
          pickStr(m.sig) ??
          [
            mintFromMsg,
            String(eventTimestamp(m)),
            side ? "b" : "s",
            String(sol),
            (++synthSeqRef.current).toString(36),
          ].join("-");

        const row: PumpPortalLiveRow = {
          id: sig,
          ts: eventTimestamp(m),
          buy: side,
          sol,
          mcUsd,
          tokenAmount: parseTokenAmount(m),
          trader: parseTrader(m),
        };

        setRows((prev) => {
          const next = [row, ...prev.filter((r) => r.id !== row.id)];
          return next.slice(0, maxRows);
        });
      }
    });

    return () => {
      unsubConn();
      unsubSrv();
      unsubTrade();
      setState("idle");
    };
  }, [mintKey, maxRows]);

  return { rows, state, error };
}

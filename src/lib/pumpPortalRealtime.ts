/**
 * One shared PumpPortal WebSocket (docs: do not open many connections).
 * subscribeTokenTrade with { keys: [mint] } on one connection.
 *
 * Keys: see `pumpPortalConfig.ts` — `VITE_PUMPPORTAL_API_KEY` and/or in-app storage.
 * @see https://pumpportal.fun/data-api/real-time/
 */

import {
  getEffectivePumpPortalApiKey,
  isPumpPortalPublicOnly,
  isPumpPortalWsDebugEnabled,
} from "@/lib/pumpPortalConfig";

const PUMP_WS = "wss://pumpportal.fun/api/data";

function buildWsUrl(): string {
  const key = getEffectivePumpPortalApiKey();
  const publicOnly = isPumpPortalPublicOnly();
  if (!publicOnly && key) {
    const u = new URL(PUMP_WS);
    u.searchParams.set("api-key", key);
    return u.toString();
  }
  return PUMP_WS;
}

export type PumpPortalTradeHandler = (msg: Record<string, unknown>) => void;

const handlersByMint = new Map<string, Set<PumpPortalTradeHandler>>();
const newTokenListeners = new Set<PumpPortalTradeHandler>();
const connListeners = new Set<(open: boolean) => void>();
const serverErrorListeners = new Set<(msg: string) => void>();

function emitConnection(open: boolean) {
  for (const cb of connListeners) cb(open);
}

function emitServerError(msg: string) {
  for (const cb of serverErrorListeners) {
    try {
      cb(msg);
    } catch {
      /* ignore */
    }
  }
}

export function subscribePumpPortalServerErrors(
  cb: (msg: string) => void,
): () => void {
  serverErrorListeners.add(cb);
  return () => serverErrorListeners.delete(cb);
}

let ws: WebSocket | null = null;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

function mintsWithListeners(): string[] {
  return [...handlersByMint.entries()]
    .filter(([, set]) => set.size > 0)
    .map(([m]) => m);
}

function hasAnyListeners(): boolean {
  return newTokenListeners.size > 0 || mintsWithListeners().length > 0;
}

function sendWhenOpen(payload: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }
}

function cancelDelayedDisconnect() {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
}

function scheduleSocketClose() {
  cancelDelayedDisconnect();
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (hasAnyListeners()) return;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }, 600);
}

function tradeMintFromPayload(msg: Record<string, unknown>): string | null {
  const top = msg.mint;
  if (typeof top === "string" && top.trim()) return top.trim();

  const params = msg.params;
  if (params != null && typeof params === "object") {
    if (Array.isArray(params)) {
      for (const el of params) {
        if (el && typeof el === "object" && !Array.isArray(el)) {
          const sub = tradeMintFromPayload(el as Record<string, unknown>);
          if (sub) return sub;
        }
      }
    } else {
      const sub = tradeMintFromPayload(params as Record<string, unknown>);
      if (sub) return sub;
    }
  }

  const jr = msg.result;
  if (jr != null && typeof jr === "object" && !Array.isArray(jr)) {
    const sub = tradeMintFromPayload(jr as Record<string, unknown>);
    if (sub) return sub;
  }

  const inner = msg.data ?? msg.payload ?? msg.trade;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const o = inner as Record<string, unknown>;
    const m = o.mint ?? o.tokenMint ?? o.baseMint;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  /** Single-frame batch: mint at top level may be missing until children are unpacked */
  if (Array.isArray(inner)) {
    for (const el of inner) {
      if (!el || typeof el !== "object" || Array.isArray(el)) continue;
      const sub = tradeMintFromPayload(el as Record<string, unknown>);
      if (sub) return sub;
    }
  }
  return null;
}

function dispatchTradePayload(msg: Record<string, unknown>) {
  if (typeof msg.message === "string" && Object.keys(msg).length === 1) return;
  const mintKey = tradeMintFromPayload(msg);
  if (!mintKey) return;

  // Route creation events (new token launches) to nursery/new-token subscribers
  if (newTokenListeners.size > 0) {
    const txType = typeof msg.txType === "string" ? msg.txType.toLowerCase() : "";
    const isCreate = txType === "create" ||
      (typeof msg.name === "string" && msg.name.length > 0 &&
       typeof msg.symbol === "string" && msg.symbol.length > 0 &&
       typeof msg.bondingCurveKey === "string");
    if (isCreate) {
      for (const fn of newTokenListeners) {
        try { fn(msg); } catch { /* ignore */ }
      }
    }
  }

  const subs = handlersByMint.get(mintKey);
  if (!subs?.size) return;
  for (const fn of subs) {
    try {
      fn(msg);
    } catch {
      /* ignore */
    }
  }
}

function maybeEmitServerError(obj: Record<string, unknown>) {
  const e = obj.errors;
  if (typeof e === "string" && e.trim()) emitServerError(e.trim());

  const er = obj.error;
  if (typeof er === "string" && er.trim()) emitServerError(er.trim());
  if (er && typeof er === "object" && !Array.isArray(er)) {
    const om = (er as Record<string, unknown>).message;
    if (typeof om === "string" && om.trim()) emitServerError(om.trim());
  }
}

/** True if this object itself looks like a trade row (vs a wrapper frame). */
function looksLikeTradeFrame(msg: Record<string, unknown>): boolean {
  if (typeof msg.mint === "string" && msg.mint.trim()) return true;
  if (typeof msg.signature === "string" || typeof msg.sig === "string") return true;
  if (typeof msg.isBuy === "boolean" || typeof msg.is_buy === "boolean") return true;
  if (typeof msg.isBuy === "number" && Number.isFinite(msg.isBuy)) return true;
  if (typeof msg.is_buy === "number" && Number.isFinite(msg.is_buy)) return true;
  if (typeof msg.txType === "string" && msg.txType.trim()) return true;
  if (typeof msg.side === "string" && msg.side.trim()) return true;
  return false;
}

/** PumpPortal sometimes wraps one or many trades in arrays under varying keys. */
const TRADE_BATCH_KEYS = [
  "data",
  "payload",
  "trades",
  "events",
  "messages",
  "updates",
  "results",
  "items",
  "result",
] as const;

function dispatchIncomingParsed(parsed: unknown) {
  if (parsed == null) return;
  if (Array.isArray(parsed)) {
    for (const item of parsed) dispatchIncomingParsed(item);
    return;
  }
  if (typeof parsed !== "object") return;
  const o = parsed as Record<string, unknown>;
  maybeEmitServerError(o);

  for (const k of TRADE_BATCH_KEYS) {
    const v = o[k];
    if (!Array.isArray(v) || v.length === 0) continue;
    const allObjects = v.every((x) => x != null && typeof x === "object" && !Array.isArray(x));
    if (!allObjects) continue;
    for (const item of v) dispatchIncomingParsed(item);
    return;
  }

  if (!looksLikeTradeFrame(o)) {
    const nest = o.data ?? o.payload ?? o.result ?? o.params;
    if (nest != null && typeof nest === "object") {
      dispatchIncomingParsed(nest);
      return;
    }
  }

  dispatchTradePayload(o);
}

function attachHandlers(socket: WebSocket) {
  socket.onopen = () => {
    const keys = mintsWithListeners();
    if (keys.length) sendWhenOpen({ method: "subscribeTokenTrade", keys });
    if (newTokenListeners.size > 0) sendWhenOpen({ method: "subscribeNewToken" });
    emitConnection(true);
  };

  socket.onmessage = (ev) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (isPumpPortalWsDebugEnabled()) {
      try {
        const s = JSON.stringify(parsed);
        console.warn("[PumpPortal WS]", s.length > 1200 ? `${s.slice(0, 1200)}…` : s);
      } catch {
        console.warn("[PumpPortal WS]", parsed);
      }
    }
    dispatchIncomingParsed(parsed);
  };

  socket.onerror = () => {};

  socket.onclose = () => {
    ws = null;
    emitConnection(false);
    if (mintsWithListeners().length === 0) return;
    setTimeout(() => ensureSocket(), 1_200);
  };
}

function ensureSocket() {
  cancelDelayedDisconnect();
  if (!hasAnyListeners()) return;
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
  ws = new WebSocket(buildWsUrl());
  attachHandlers(ws);
}

/** Subscribe to new token creation events (all launches, globally). */
export function subscribeNewTokens(handler: PumpPortalTradeHandler): () => void {
  newTokenListeners.add(handler);
  cancelDelayedDisconnect();
  ensureSocket();
  if (ws?.readyState === WebSocket.OPEN) sendWhenOpen({ method: "subscribeNewToken" });
  return () => {
    newTokenListeners.delete(handler);
    if (!hasAnyListeners()) scheduleSocketClose();
  };
}

/** Close and reopen when API key / mode changes (call after updating storage or env). */
export function refreshPumpPortalSocket(): void {
  cancelDelayedDisconnect();
  const active = mintsWithListeners().length > 0;
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  emitConnection(false);
  if (active) ensureSocket();
}

export function subscribePumpPortalSocketState(
  cb: (open: boolean) => void,
): () => void {
  connListeners.add(cb);
  cb(ws?.readyState === WebSocket.OPEN);
  return () => connListeners.delete(cb);
}

export function subscribePumpPortalTokenTrades(
  mint: string,
  handler: PumpPortalTradeHandler,
): () => void {
  const key = mint.trim();
  if (!key) return () => {};

  cancelDelayedDisconnect();

  const set = handlersByMint.get(key) ?? new Set<PumpPortalTradeHandler>();
  const firstListenerForMint = set.size === 0;
  set.add(handler);
  handlersByMint.set(key, set);

  ensureSocket();
  if (ws?.readyState === WebSocket.OPEN && firstListenerForMint) {
    sendWhenOpen({ method: "subscribeTokenTrade", keys: [key] });
  }

  return () => {
    const s = handlersByMint.get(key);
    if (s) {
      s.delete(handler);
      if (s.size === 0) handlersByMint.delete(key);
    }
    if (ws?.readyState === WebSocket.OPEN && !handlersByMint.has(key)) {
      try {
        ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [key] }));
      } catch {
        /* ignore */
      }
    }
    if (mintsWithListeners().length === 0) scheduleSocketClose();
  };
}

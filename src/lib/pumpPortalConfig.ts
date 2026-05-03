/**
 * PumpPortal configuration: Vite env vars + optional browser API key (localStorage).
 * In-app key overrides `VITE_PUMPPORTAL_API_KEY` so users can onboard without rebuilding.
 *
 * Public-only websocket mode is env-only: `VITE_PUMPPORTAL_WS_PUBLIC_ONLY=1` (no UI toggle).
 */

import { looksLikeSolanaAddress } from "@/lib/solanaBalance";
import { tryPubkeyFromSolanaWalletSecret } from "@/lib/solanaWalletSecret";

export const PUMPPORTAL_CONFIG_CHANGED_EVENT = "unt:pumpportal-config";

/**
 * PumpPortal docs: keep ~0.02 SOL on the API-linked wallet for trade streams. Chip uses a tiny epsilon so RPC/UI rounding at exactly the nominal minimum still reads “funded”.
 */
export const PUMPPORTAL_MIN_LINKED_WALLET_SOL = 0.02;
/** Lamports-like dust so 0.019999… SOL from RPC still counts as meeting the doc threshold. */
const FUNDING_EPSILON_SOL = 0.00025;

export function isPumpPortalLinkedWalletFunded(sol: number): boolean {
  return sol >= PUMPPORTAL_MIN_LINKED_WALLET_SOL - FUNDING_EPSILON_SOL;
}

/** Set localStorage `unt_debug_pumpportal_ws` = `1` and reload — logs truncated WS frames to the console. */
export function isPumpPortalWsDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("unt_debug_pumpportal_ws") === "1";
  } catch {
    return false;
  }
}

const LS_API_KEY = "unt_pumpportal_api_key_v1";
const LS_LINKED_WALLET = "unt_pumpportal_linked_wallet_v1";
const LS_TRADING_WALLET_SECRET = "unt_pumpportal_trading_wallet_secret_v1";

export function emitPumpPortalConfigChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PUMPPORTAL_CONFIG_CHANGED_EVENT));
}

function readEnvPublicOnly(): boolean {
  return (
    import.meta.env.VITE_PUMPPORTAL_WS_PUBLIC_ONLY === "true" ||
    import.meta.env.VITE_PUMPPORTAL_WS_PUBLIC_ONLY === "1"
  );
}

function readEnvApiKey(): string {
  return (import.meta.env.VITE_PUMPPORTAL_API_KEY as string | undefined)?.trim() ?? "";
}

/** True when `.env` forces connecting without `?api-key=` (order book usually empty). */
export function isPumpPortalPublicOnly(): boolean {
  return readEnvPublicOnly();
}

export function getStoredPumpPortalApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LS_API_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setStoredPumpPortalApiKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_API_KEY, key.trim());
  } catch (e) {
    console.error("[PumpPortal] Could not save API key to localStorage:", e);
    return;
  }
  emitPumpPortalConfigChanged();
}

export function clearStoredPumpPortalApiKey(): void {
  try {
    localStorage.removeItem(LS_API_KEY);
  } catch {
    /* ignore */
  }
  emitPumpPortalConfigChanged();
}

/** Browser storage wins over `VITE_PUMPPORTAL_API_KEY` so users can paste a key without restarting Vite. */
export function getEffectivePumpPortalApiKey(): string {
  const stored = getStoredPumpPortalApiKey();
  if (stored) return stored;
  return readEnvApiKey();
}

/** How the shared WS URL is built — drives UI hints when the order book stays empty. */
export type PumpPortalWsMode = "api-key" | "public-only" | "anonymous";

export function getPumpPortalWsMode(): PumpPortalWsMode {
  const key = getEffectivePumpPortalApiKey();
  const publicOnly = isPumpPortalPublicOnly();
  if (!publicOnly && key) return "api-key";
  if (publicOnly) return "public-only";
  return "anonymous";
}

/** Legacy pubkey-only field — still read if trading secret is empty (older setups). */
function readLegacyLinkedWalletPubkey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LS_LINKED_WALLET)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** PumpPortal trading wallet secret — browser-only; used to derive pubkey for balance UI. */
export function getStoredPumpPortalTradingWalletSecret(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LS_TRADING_WALLET_SECRET)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setStoredPumpPortalTradingWalletSecret(secret: string): void {
  if (typeof window === "undefined") return;
  try {
    const s = secret.trim();
    if (!s) localStorage.removeItem(LS_TRADING_WALLET_SECRET);
    else localStorage.setItem(LS_TRADING_WALLET_SECRET, s);
  } catch (e) {
    console.error("[PumpPortal] Could not save trading wallet secret to localStorage:", e);
    return;
  }
  emitPumpPortalConfigChanged();
}

/**
 * Effective Solana pubkey for RPC balance + badges — from saved trading-wallet secret, else legacy pasted address.
 */
export function getPumpPortalTradingWalletPubkey(): string | null {
  const secret = getStoredPumpPortalTradingWalletSecret().trim();
  if (secret) {
    const fromSecret = tryPubkeyFromSolanaWalletSecret(secret);
    if (fromSecret) return fromSecret;
  }
  const legacy = readLegacyLinkedWalletPubkey();
  return looksLikeSolanaAddress(legacy) ? legacy.trim() : null;
}

/** Append Setup-derived wallet lines so Lightning/API errors are actionable (fund / match PumpPortal). */
export function appendPumpPortalTradingWalletHint(message: string): string {
  const m = message.trim();
  const pk = getPumpPortalTradingWalletPubkey();
  if (!pk) {
    return `${m}\n\nWallet: paste your PumpPortal wallet secret in Setup to show your address and SOL balance. Lightning still spends from the wallet PumpPortal links to your API key — keep them the same.`;
  }
  return `${m}\n\nWallet (from Setup — fund/match PumpPortal): ${pk}`;
}

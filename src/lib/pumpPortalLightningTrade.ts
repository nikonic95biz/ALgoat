/**
 * PumpPortal Lightning Transaction API — trades execute from the SOL wallet linked to your API key.
 * See https://pumpportal.fun/trading-api/ — handles Pump.fun + migrated pools (Token-2022 etc.) server-side.
 */

export type PumpPortalLightningTradeBody = {
  action: "buy" | "sell";
  mint: string;
  /** SOL amount (buy) or token amount / percent string (sell, e.g. "100%"). */
  amount: number | string;
  denominatedInSol: "true" | "false";
  slippage: number;
  priorityFee: number;
  pool?: string;
  skipPreflight?: "true" | "false";
};

const TRADE_URL = "https://pumpportal.fun/api/trade";

export async function postPumpPortalLightningTrade(
  apiKey: string,
  body: PumpPortalLightningTradeBody,
): Promise<{ ok: true; signature: string } | { ok: false; message: string }> {
  const url = `${TRADE_URL}?api-key=${encodeURIComponent(apiKey.trim())}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Network error calling PumpPortal trade API",
    };
  }

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* plain-text error */
  }

  if (!res.ok) {
    const msg =
      json?.error != null
        ? String(json.error)
        : json?.errors != null
          ? String(json.errors)
          : text.trim().slice(0, 280) || `HTTP ${res.status}`;
    return { ok: false, message: msg };
  }

  const sig =
    json?.signature != null
      ? String(json.signature)
      : json?.txSig != null
        ? String(json.txSig)
        : "";
  if (!sig) {
    return { ok: false, message: text.trim().slice(0, 280) || "No signature in PumpPortal response" };
  }
  return { ok: true, signature: sig };
}

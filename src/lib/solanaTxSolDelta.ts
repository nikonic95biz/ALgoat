/**
 * Native SOL balance change for a wallet in one confirmed transaction (via RPC `getTransaction` meta).
 */

import { fetchSolanaRpc } from "@/lib/solanaRpc";

function collectAccountPubkeys(tx: Record<string, unknown>): string[] | null {
  const transaction = tx.transaction as Record<string, unknown> | undefined;
  if (!transaction) return null;
  const message = transaction.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const keys: string[] = [];
  const keysRaw = message.accountKeys;
  if (Array.isArray(keysRaw)) {
    for (const k of keysRaw) {
      if (typeof k === "string") keys.push(k);
      else if (k && typeof k === "object" && "pubkey" in k) {
        keys.push(String((k as { pubkey: string }).pubkey));
      }
    }
  }

  const meta = tx.meta as Record<string, unknown> | undefined;
  const loaded = meta?.loadedAddresses as { writable?: unknown[]; readonly?: unknown[] } | undefined;
  if (loaded) {
    for (const w of loaded.writable ?? []) keys.push(String(w));
    for (const r of loaded.readonly ?? []) keys.push(String(r));
  }

  return keys.length ? keys : null;
}

/**
 * Wallet SOL balance delta for this tx (post − pre), in SOL not lamports.
 * Negative means SOL left the wallet (typical buy); positive means SOL returned (typical sell).
 */
export async function fetchWalletSolDeltaSol(signature: string, walletPubkey: string): Promise<number | null> {
  const sig = signature.trim();
  const pk = walletPubkey.trim();
  if (!sig || !pk) return null;

  // Exponential backoff: 800ms, 1.2s, 1.8s, 2.7s, 4s, 6s, 9s, 13s, 18s, 25s, 35s, 50s
  for (let attempt = 0; attempt < 12; attempt++) {
    const backoffMs = Math.min(800 * Math.pow(1.5, attempt), 50_000);
    let res: Response;
    try {
      res = await fetchSolanaRpc({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          sig,
          {
            encoding: "json",
            // Accept versioned transactions (version 0 and legacy)
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          },
        ],
      });
    } catch {
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    if (!res.ok) {
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    const json = (await res.json()) as {
      result?: Record<string, unknown> | null;
      error?: unknown;
    };

    if (json.error != null) {
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    const result = json.result;
    if (result == null) {
      // Transaction not yet visible — wait longer before retrying
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    const meta = result.meta as { err?: unknown; preBalances?: number[]; postBalances?: number[] } | undefined;
    // Transaction failed on-chain — don't retry
    if (meta?.err != null) return null;

    const keys = collectAccountPubkeys(result);
    const pre = meta?.preBalances;
    const post = meta?.postBalances;
    if (!keys || !pre || !post || keys.length !== pre.length || keys.length !== post.length) {
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    const idx = keys.findIndex((k) => k === pk);
    // Wallet not a signer in this tx — return 0 rather than null so PnL row is still recorded
    if (idx < 0) return 0;

    return (post[idx]! - pre[idx]!) / 1e9;
  }

  return null;
}

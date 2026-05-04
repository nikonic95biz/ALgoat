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

  for (let attempt = 0; attempt < 8; attempt++) {
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
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          },
        ],
      });
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    const json = (await res.json()) as {
      result?: Record<string, unknown> | null;
      error?: unknown;
    };

    if (json.error != null) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    const result = json.result;
    if (result == null) {
      await new Promise((r) => setTimeout(r, 900));
      continue;
    }

    const meta = result.meta as { err?: unknown; preBalances?: number[]; postBalances?: number[] } | undefined;
    if (meta?.err != null) return null;

    const keys = collectAccountPubkeys(result);
    const pre = meta?.preBalances;
    const post = meta?.postBalances;
    if (!keys || !pre || !post || keys.length !== pre.length || keys.length !== post.length) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    const idx = keys.findIndex((k) => k === pk);
    if (idx < 0) return null;

    return (post[idx]! - pre[idx]!) / 1e9;
  }

  return null;
}

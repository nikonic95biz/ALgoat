import { fetchSolanaRpc } from "@/lib/solanaRpc";

/** Loose Solana address shape (base58); same heuristic as mint inputs elsewhere. */
const ADDR_LIKELY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function looksLikeSolanaAddress(s: string): boolean {
  return ADDR_LIKELY.test(s.trim());
}

type RpcBalance = {
  jsonrpc: string;
  id: number;
  result?: { context?: { slot?: number }; value?: number };
  error?: { message?: string };
};

/** Native SOL balance for an account (lamports → SOL). */
export async function fetchNativeSolBalance(pubkey: string): Promise<number | null> {
  const pk = pubkey.trim();
  if (!pk) return null;
  try {
    const res = await fetchSolanaRpc({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [pk] });
    if (!res.ok) return null;
    const data = (await res.json()) as RpcBalance;
    if (data.error != null) return null;
    const lamports = data.result?.value;
    if (typeof lamports !== "number" || !Number.isFinite(lamports)) return null;
    return lamports / 1e9;
  } catch {
    return null;
  }
}

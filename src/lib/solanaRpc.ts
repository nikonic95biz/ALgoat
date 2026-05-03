/** Shared Solana JSON-RPC URL (chart supply, native balances). */

export function getSolanaRpcUrl(): string {
  const u = import.meta.env?.VITE_SOLANA_RPC_URL;
  return typeof u === "string" && u.startsWith("http")
    ? u
    : "https://api.mainnet-beta.solana.com";
}

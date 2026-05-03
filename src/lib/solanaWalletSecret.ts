import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

/** Decode Phantom-style JSON array, base58 secret, or hex (no 0x). Returns null if unusable. */
function decodeSolanaSecretBytes(trimmed: string): Uint8Array | null {
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr) && arr.every((x) => typeof x === "number")) {
        return Uint8Array.from(arr);
      }
    } catch {
      return null;
    }
    return null;
  }
  try {
    return bs58.decode(trimmed);
  } catch {
    /* fallthrough */
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const pairs = trimmed.match(/.{1,2}/g);
    if (pairs) return Uint8Array.from(pairs.map((b) => parseInt(b, 16)));
  }
  return null;
}

/** Derive base58 pubkey from a raw Solana wallet secret (same formats Phantom / CLI often export). */
export function tryPubkeyFromSolanaWalletSecret(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const secretBytes = decodeSolanaSecretBytes(trimmed);
  if (!secretBytes || secretBytes.length < 32) return null;
  try {
    const kp = Keypair.fromSecretKey(secretBytes);
    return kp.publicKey.toBase58();
  } catch {
    return null;
  }
}

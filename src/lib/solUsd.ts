let cached: { value: number; at: number } | null = null;
const TTL_MS = 60_000;

export async function getSolUsd(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: ac.signal },
    );
    clearTimeout(t);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { solana?: { usd?: number } };
    const v = data?.solana?.usd;
    if (typeof v === "number" && v > 0) {
      cached = { value: v, at: now };
      return v;
    }
  } catch {
    /* fall through */
  }
  return cached?.value ?? 150;
}

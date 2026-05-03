/**
 * Fetch token metadata from pump.fun and/or DexScreener.
 * Both requests go through same-origin proxy paths (Vercel rewrites / Vite proxy).
 */

export type TokenMeta = {
  name: string;
  symbol: string;
  imageUri: string | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  /** Pump.fun bonding-curve MC in USD (pre-bond) */
  pumpMcUsd: number | null;
  /** DexScreener liquidity USD (post-bond) */
  liquidityUsd: number | null;
  /** DexScreener 24h volume USD */
  volumeUsd24h: number | null;
  /** DexScreener price USD */
  priceUsd: number | null;
  /** DEX pair URL for opening on DexScreener */
  dexUrl: string | null;
  bonded: boolean;
};

type PumpCoin = {
  name?: string;
  symbol?: string;
  image_uri?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  usd_market_cap?: number;
  complete?: boolean;
};

type DexPair = {
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  url?: string;
  baseToken?: { name?: string; symbol?: string };
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
};

async function fetchPumpMeta(mint: string): Promise<PumpCoin | null> {
  try {
    const res = await fetch(`/pump-frontend/coins/${encodeURIComponent(mint)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as PumpCoin;
  } catch {
    return null;
  }
}

async function fetchDexMeta(mint: string): Promise<DexPair | null> {
  try {
    const res = await fetch(`/dex-api/latest/dex/tokens/${encodeURIComponent(mint)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { pairs?: DexPair[] };
    // Pick the pair with highest liquidity
    const pairs = j.pairs ?? [];
    if (pairs.length === 0) return null;
    return pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
  } catch {
    return null;
  }
}

export async function fetchTokenMeta(mint: string): Promise<TokenMeta | null> {
  const [pump, dex] = await Promise.all([fetchPumpMeta(mint), fetchDexMeta(mint)]);
  if (!pump && !dex) return null;

  const twitter =
    pump?.twitter?.trim() ||
    dex?.info?.socials?.find((s) => s.type === "twitter")?.url?.trim() ||
    null;
  const telegram =
    pump?.telegram?.trim() ||
    dex?.info?.socials?.find((s) => s.type === "telegram")?.url?.trim() ||
    null;
  const website =
    pump?.website?.trim() ||
    dex?.info?.websites?.[0]?.url?.trim() ||
    null;

  return {
    name: pump?.name?.trim() || dex?.baseToken?.name?.trim() || "Unknown",
    symbol: pump?.symbol?.trim() || dex?.baseToken?.symbol?.trim() || "???",
    imageUri: pump?.image_uri?.trim() || dex?.info?.imageUrl?.trim() || null,
    description: pump?.description?.trim() || null,
    twitter: normaliseLink(twitter),
    telegram: normaliseLink(telegram),
    website: normaliseLink(website),
    pumpMcUsd: typeof pump?.usd_market_cap === "number" ? pump.usd_market_cap : null,
    liquidityUsd: dex?.liquidity?.usd ?? null,
    volumeUsd24h: dex?.volume?.h24 ?? null,
    priceUsd: dex?.priceUsd ? Number(dex.priceUsd) || null : null,
    dexUrl: dex?.url ?? null,
    bonded: pump?.complete === true || dex != null,
  };
}

function normaliseLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (!u) return null;
  if (u.startsWith("http")) return u;
  return `https://${u}`;
}

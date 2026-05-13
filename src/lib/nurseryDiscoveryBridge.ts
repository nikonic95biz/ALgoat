import { chooseDiscoveryTier, getDiscoveryPolicy, scoreDiscoveryToken } from "@/lib/discoveryPolicy";
import { discoveryBus } from "@/lib/discoveryBus";
import {
  createDiscoveryEventId,
  createUnknownQuality,
  type DiscoveryEvent,
  type DiscoveryTokenRecord,
} from "@/lib/discoveryTypes";
import type { BondedToken, NurserySnapshot, PreBondToken } from "@/lib/nurseryEngine";

const SOL_USD_FALLBACK = 160;

function prebondToDiscoveryToken(token: PreBondToken, now: number): DiscoveryTokenRecord {
  const marketCapUsd = token.marketCapSol > 0 ? token.marketCapSol * SOL_USD_FALLBACK : null;
  const totalTrades = token.buys5m + token.sells5m;
  const buyPressurePct = totalTrades > 0 ? (token.buys5m / totalTrades) * 100 : null;
  const scored = scoreDiscoveryToken({
    lastTradeAt: token.lastTradeMs,
    marketCapUsd,
    liquidityUsd: null,
    buyPressurePct,
    strategyBoost: token.maxSingleBuySol >= 0.3 ? 10 : 0,
  }, now);
  const policy = getDiscoveryPolicy("public");
  const tier = chooseDiscoveryTier(scored.score, policy);
  return {
    mint: token.mint,
    symbol: token.symbol || null,
    name: token.name || null,
    lifecycle: "pre-bond",
    tier,
    firstSeenAt: token.firstSeenMs,
    lastSeenAt: now,
    lastTradeAt: token.lastTradeMs,
    marketCapUsd,
    liquidityUsd: null,
    score: scored.score,
    scoreReason: scored.reason,
    sources: ["pumpportal", "pumpfun"],
    quality: createUnknownQuality(now, token.lastTradeMs),
  };
}

function bondedToDiscoveryToken(token: BondedToken, now: number): DiscoveryTokenRecord {
  const totalTrades = token.buys1h + token.sells1h;
  const buyPressurePct = totalTrades > 0 ? (token.buys1h / totalTrades) * 100 : null;
  const avgHourly = token.vol24h > 0 ? token.vol24h / 24 : 0;
  const volumeAcceleration = avgHourly > 0 ? token.vol1h / avgHourly : null;
  const scored = scoreDiscoveryToken({
    lastTradeAt: token.lastUpdatedMs || token.bondedMs,
    marketCapUsd: token.marketCapUsd || null,
    liquidityUsd: token.liquidityUsd || null,
    buyPressurePct,
    volumeAcceleration,
    strategyBoost: token.revivalScore > 0 ? Math.min(20, token.revivalScore * 2) : 0,
  }, now);
  const policy = getDiscoveryPolicy("public");
  const tier = chooseDiscoveryTier(scored.score, policy);
  return {
    mint: token.mint,
    symbol: token.symbol || null,
    name: token.name || null,
    lifecycle: "graduated",
    tier,
    firstSeenAt: token.bondedMs,
    lastSeenAt: now,
    lastTradeAt: token.lastUpdatedMs || token.bondedMs,
    marketCapUsd: token.marketCapUsd || null,
    liquidityUsd: token.liquidityUsd || null,
    score: scored.score,
    scoreReason: token.revivalScore > 0 ? `${scored.reason} · revival ${token.revivalScore.toFixed(1)}` : scored.reason,
    sources: ["pumpfun", "dexscreener"],
    quality: createUnknownQuality(now, token.lastUpdatedMs || token.bondedMs),
  };
}

function tokenSeenEvent(token: DiscoveryTokenRecord, source: "pumpfun" | "dexscreener", now: number): DiscoveryEvent {
  return {
    id: createDiscoveryEventId("token_seen", token.mint, token.firstSeenAt),
    kind: "token_seen",
    mint: token.mint,
    source,
    observedAt: token.firstSeenAt,
    receivedAt: now,
    quality: token.quality,
    symbol: token.symbol,
    name: token.name,
    lifecycle: token.lifecycle,
  };
}

function tokenScoreEvent(token: DiscoveryTokenRecord, now: number): DiscoveryEvent {
  return {
    id: createDiscoveryEventId("token_score", token.mint, now),
    kind: "token_score",
    mint: token.mint,
    source: "strategy",
    observedAt: now,
    receivedAt: now,
    quality: token.quality,
    score: token.score,
    reason: token.scoreReason,
    tier: token.tier,
  };
}

export async function ingestNurserySnapshot(snapshot: NurserySnapshot, now = Date.now()): Promise<void> {
  const unique = new Map<string, DiscoveryTokenRecord>();

  for (const token of snapshot.newPairsList) unique.set(token.mint, prebondToDiscoveryToken(token, now));
  for (const token of snapshot.graduatingList) unique.set(token.mint, prebondToDiscoveryToken(token, now));
  for (const token of snapshot.bondedList) unique.set(token.mint, bondedToDiscoveryToken(token, now));
  for (const token of snapshot.oldPairsList) unique.set(token.mint, bondedToDiscoveryToken(token, now));

  for (const token of unique.values()) {
    await discoveryBus.upsertToken(token);
    await discoveryBus.appendEvent(tokenSeenEvent(token, token.lifecycle === "pre-bond" ? "pumpfun" : "dexscreener", now));
    await discoveryBus.appendEvent(tokenScoreEvent(token, now));
  }
}

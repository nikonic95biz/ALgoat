import type { DiscoveryTier, DiscoveryTokenRecord } from "@/lib/discoveryTypes";

export type DiscoveryMode = "public" | "apiKey" | "localWorker";

export type DiscoveryPolicy = {
  mode: DiscoveryMode;
  maxSubscribedMints: number;
  maxCandidates: number;
  maxTradeEventsPerMint: number;
  candidateTtlMs: number;
  watchTtlMs: number;
  staleFeedMs: number;
  restPollMinMs: number;
  dexScreenerPollMinMs: number;
  scoreThresholds: {
    candidate: number;
    watch: number;
    position: number;
  };
};

const MINUTE = 60_000;

export const DISCOVERY_POLICIES: Record<DiscoveryMode, DiscoveryPolicy> = {
  public: {
    mode: "public",
    maxSubscribedMints: 50,
    maxCandidates: 300,
    maxTradeEventsPerMint: 80,
    candidateTtlMs: 45 * MINUTE,
    watchTtlMs: 20 * MINUTE,
    staleFeedMs: 45_000,
    restPollMinMs: 120_000,
    dexScreenerPollMinMs: 180_000,
    scoreThresholds: { candidate: 20, watch: 55, position: 90 },
  },
  apiKey: {
    mode: "apiKey",
    maxSubscribedMints: 120,
    maxCandidates: 600,
    maxTradeEventsPerMint: 160,
    candidateTtlMs: 90 * MINUTE,
    watchTtlMs: 35 * MINUTE,
    staleFeedMs: 45_000,
    restPollMinMs: 90_000,
    dexScreenerPollMinMs: 120_000,
    scoreThresholds: { candidate: 18, watch: 50, position: 90 },
  },
  localWorker: {
    mode: "localWorker",
    maxSubscribedMints: 200,
    maxCandidates: 1_200,
    maxTradeEventsPerMint: 300,
    candidateTtlMs: 180 * MINUTE,
    watchTtlMs: 60 * MINUTE,
    staleFeedMs: 45_000,
    restPollMinMs: 60_000,
    dexScreenerPollMinMs: 90_000,
    scoreThresholds: { candidate: 15, watch: 45, position: 90 },
  },
};

export function getDiscoveryPolicy(mode: DiscoveryMode): DiscoveryPolicy {
  return DISCOVERY_POLICIES[mode];
}

export function tierRank(tier: DiscoveryTier): number {
  if (tier === "position") return 4;
  if (tier === "watch") return 3;
  if (tier === "candidate") return 2;
  return 1;
}

export function scoreDiscoveryToken(token: {
  lastTradeAt: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  buyPressurePct?: number | null;
  volumeAcceleration?: number | null;
  strategyBoost?: number | null;
}, now = Date.now()): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  if (token.lastTradeAt != null) {
    const ageMin = Math.max(0, (now - token.lastTradeAt) / MINUTE);
    const freshness = Math.max(0, 30 - ageMin);
    score += freshness;
    reasons.push(`fresh ${ageMin.toFixed(1)}m`);
  }

  if ((token.marketCapUsd ?? 0) >= 9_000) {
    score += 15;
    reasons.push("mc floor");
  }

  if ((token.liquidityUsd ?? 0) >= 500) {
    score += 15;
    reasons.push("liquidity");
  }

  if (token.buyPressurePct != null) {
    score += Math.max(0, token.buyPressurePct - 45) * 0.4;
    reasons.push(`buy pressure ${token.buyPressurePct.toFixed(0)}%`);
  }

  if (token.volumeAcceleration != null) {
    score += Math.min(20, Math.max(0, token.volumeAcceleration * 4));
    reasons.push(`vol accel ${token.volumeAcceleration.toFixed(1)}x`);
  }

  if (token.strategyBoost != null) {
    score += token.strategyBoost;
    reasons.push("strategy boost");
  }

  return {
    score: Math.max(0, Math.min(100, Number(score.toFixed(2)))),
    reason: reasons.length ? reasons.join(" · ") : "insufficient signal",
  };
}

export function chooseDiscoveryTier(score: number, policy: DiscoveryPolicy): DiscoveryTier {
  if (score >= policy.scoreThresholds.position) return "position";
  if (score >= policy.scoreThresholds.watch) return "watch";
  if (score >= policy.scoreThresholds.candidate) return "candidate";
  return "scan";
}

export function shouldEvictToken(token: DiscoveryTokenRecord, policy: DiscoveryPolicy, now = Date.now()): boolean {
  if (token.tier === "position") return false;
  const lastActive = token.lastTradeAt ?? token.lastSeenAt;
  const ttl = token.tier === "watch" ? policy.watchTtlMs : policy.candidateTtlMs;
  return now - lastActive > ttl;
}

export function sortDiscoveryPriority(a: DiscoveryTokenRecord, b: DiscoveryTokenRecord): number {
  const tierDelta = tierRank(b.tier) - tierRank(a.tier);
  if (tierDelta !== 0) return tierDelta;
  const scoreDelta = b.score - a.score;
  if (scoreDelta !== 0) return scoreDelta;
  return b.lastSeenAt - a.lastSeenAt;
}

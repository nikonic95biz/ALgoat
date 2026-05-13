export type DiscoverySource =
  | "pumpportal"
  | "pumpfun"
  | "dexscreener"
  | "solana-rpc"
  | "strategy"
  | "user";

export type DiscoveryTier = "scan" | "candidate" | "watch" | "position";

export type DiscoveryLifecycle =
  | "unknown"
  | "pre-bond"
  | "graduated"
  | "migrated"
  | "inactive";

export type DiscoveryEventKind =
  | "token_seen"
  | "token_trade"
  | "token_metadata"
  | "token_graduated"
  | "token_score"
  | "watchlist"
  | "health";

export type DiscoveryDataQuality = {
  freshnessMs: number | null;
  confidence: number;
  missingFields: string[];
  stale: boolean;
};

export type DiscoveryTokenRecord = {
  mint: string;
  symbol: string | null;
  name: string | null;
  lifecycle: DiscoveryLifecycle;
  tier: DiscoveryTier;
  firstSeenAt: number;
  lastSeenAt: number;
  lastTradeAt: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  score: number;
  scoreReason: string;
  sources: DiscoverySource[];
  quality: DiscoveryDataQuality;
};

export type DiscoveryBaseEvent = {
  id: string;
  kind: DiscoveryEventKind;
  mint: string | null;
  source: DiscoverySource;
  observedAt: number;
  receivedAt: number;
  quality: DiscoveryDataQuality;
};

export type TokenSeenEvent = DiscoveryBaseEvent & {
  kind: "token_seen";
  mint: string;
  symbol: string | null;
  name: string | null;
  lifecycle: DiscoveryLifecycle;
};

export type TokenTradeEvent = DiscoveryBaseEvent & {
  kind: "token_trade";
  mint: string;
  side: "buy" | "sell" | "unknown";
  solAmount: number;
  tokenAmount: number | null;
  marketCapUsd: number | null;
  trader: string | null;
  signature: string | null;
};

export type TokenMetadataEvent = DiscoveryBaseEvent & {
  kind: "token_metadata";
  mint: string;
  symbol: string | null;
  name: string | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
};

export type TokenGraduatedEvent = DiscoveryBaseEvent & {
  kind: "token_graduated";
  mint: string;
  graduatedAt: number;
  venue: "pump-amm" | "raydium" | "unknown";
};

export type TokenScoreEvent = DiscoveryBaseEvent & {
  kind: "token_score";
  mint: string;
  score: number;
  reason: string;
  tier: DiscoveryTier;
};

export type WatchlistEvent = DiscoveryBaseEvent & {
  kind: "watchlist";
  mint: string;
  strategyId: string;
  sessionId: string | null;
  action: "watch" | "unwatch" | "promote" | "evict";
  reason: string;
  tier: DiscoveryTier;
};

export type DiscoveryHealthEvent = DiscoveryBaseEvent & {
  kind: "health";
  mint: null;
  status: "ok" | "degraded" | "down";
  message: string;
};

export type DiscoveryEvent =
  | TokenSeenEvent
  | TokenTradeEvent
  | TokenMetadataEvent
  | TokenGraduatedEvent
  | TokenScoreEvent
  | WatchlistEvent
  | DiscoveryHealthEvent;

export type DiscoverySnapshot = {
  tokens: DiscoveryTokenRecord[];
  events: DiscoveryEvent[];
  health: {
    status: "ok" | "degraded" | "down";
    lastEventAt: number | null;
    subscribedMints: number;
    candidateCount: number;
    watchCount: number;
  };
};

export function createDiscoveryEventId(kind: DiscoveryEventKind, mint: string | null, observedAt: number): string {
  return `${kind}:${mint ?? "global"}:${observedAt}`;
}

export function createUnknownQuality(now: number, observedAt = now): DiscoveryDataQuality {
  const freshnessMs = Math.max(0, now - observedAt);
  return {
    freshnessMs,
    confidence: 0.5,
    missingFields: [],
    stale: false,
  };
}

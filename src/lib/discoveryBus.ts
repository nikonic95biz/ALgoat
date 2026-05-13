import { getDiscoveryPolicy, type DiscoveryMode, type DiscoveryPolicy } from "@/lib/discoveryPolicy";
import { discoveryStore, type DiscoveryDatasetExport, type DiscoveryStore } from "@/lib/discoveryStore";
import type { DiscoveryEvent, DiscoverySnapshot, DiscoveryTokenRecord } from "@/lib/discoveryTypes";

export type DiscoverySubscriptionRequest = {
  mint: string;
  strategyId: string;
  sessionId: string | null;
  reason: string;
  priority: number;
};

export type DiscoveryBusSnapshot = DiscoverySnapshot & {
  policy: DiscoveryPolicy;
  requestedSubscriptions: DiscoverySubscriptionRequest[];
};

type DiscoveryListener = (snapshot: DiscoveryBusSnapshot) => void;

export class DiscoveryBus {
  private listeners = new Set<DiscoveryListener>();
  private requestedSubscriptions = new Map<string, DiscoverySubscriptionRequest>();

  constructor(
    private readonly store: DiscoveryStore,
    private mode: DiscoveryMode = "public",
  ) {}

  get policy(): DiscoveryPolicy {
    return getDiscoveryPolicy(this.mode);
  }

  setMode(mode: DiscoveryMode): void {
    this.mode = mode;
    void this.emit();
  }

  async upsertToken(token: DiscoveryTokenRecord): Promise<void> {
    await this.store.upsertToken(token);
    await this.emit();
  }

  async appendEvent(event: DiscoveryEvent): Promise<void> {
    await this.store.appendEvent(event);
    await this.emit();
  }

  requestSubscription(request: DiscoverySubscriptionRequest): void {
    const existing = this.requestedSubscriptions.get(request.mint);
    if (!existing || request.priority >= existing.priority) {
      this.requestedSubscriptions.set(request.mint, request);
      void this.emit();
    }
  }

  releaseSubscription(mint: string, strategyId: string): void {
    const existing = this.requestedSubscriptions.get(mint);
    if (existing?.strategyId === strategyId) {
      this.requestedSubscriptions.delete(mint);
      void this.emit();
    }
  }

  async snapshot(): Promise<DiscoveryBusSnapshot> {
    const base = await this.store.snapshot();
    return {
      ...base,
      policy: this.policy,
      requestedSubscriptions: [...this.requestedSubscriptions.values()]
        .sort((a, b) => b.priority - a.priority)
        .slice(0, this.policy.maxSubscribedMints),
    };
  }

  async activeTokens(limit = 200): Promise<DiscoveryTokenRecord[]> {
    const snap = await this.snapshot();
    return [...snap.tokens]
      .sort((a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt)
      .slice(0, limit);
  }

  async tokensForTier(tier: DiscoveryTokenRecord["tier"], limit = 200): Promise<DiscoveryTokenRecord[]> {
    const snap = await this.snapshot();
    return snap.tokens
      .filter((token) => token.tier === tier)
      .sort((a, b) => b.score - a.score || b.lastSeenAt - a.lastSeenAt)
      .slice(0, limit);
  }

  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener);
    void this.snapshot().then(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async exportDataset(): Promise<DiscoveryDatasetExport> {
    return this.store.exportDataset();
  }

  async importDataset(data: DiscoveryDatasetExport): Promise<void> {
    await this.store.importDataset(data);
    await this.emit();
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) return;
    const snapshot = await this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const discoveryBus = new DiscoveryBus(discoveryStore);

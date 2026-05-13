import type { DiscoveryEvent, DiscoverySnapshot, DiscoveryTokenRecord } from "@/lib/discoveryTypes";

const DB_NAME = "solclaw_discovery_v1";
const DB_VERSION = 1;
const TOKENS = "tokens";
const EVENTS = "events";

export type DiscoveryDatasetExport = {
  version: 1;
  exportedAt: number;
  tokens: DiscoveryTokenRecord[];
  events: DiscoveryEvent[];
};

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDiscoveryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TOKENS)) {
        const store = db.createObjectStore(TOKENS, { keyPath: "mint" });
        store.createIndex("tier", "tier", { unique: false });
        store.createIndex("lastSeenAt", "lastSeenAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(EVENTS)) {
        const store = db.createObjectStore(EVENTS, { keyPath: "id" });
        store.createIndex("mint", "mint", { unique: false });
        store.createIndex("kind", "kind", { unique: false });
        store.createIndex("receivedAt", "receivedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function putMany<T>(db: IDBDatabase, storeName: string, rows: T[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function clearStore(db: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export class DiscoveryStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private memoryTokens = new Map<string, DiscoveryTokenRecord>();
  private memoryEvents = new Map<string, DiscoveryEvent>();

  private async db(): Promise<IDBDatabase | null> {
    if (!canUseIndexedDb()) return null;
    this.dbPromise ??= openDiscoveryDb().catch(() => null);
    return this.dbPromise;
  }

  async upsertToken(token: DiscoveryTokenRecord): Promise<void> {
    this.memoryTokens.set(token.mint, token);
    const db = await this.db();
    if (!db) return;
    await putMany(db, TOKENS, [token]);
  }

  async appendEvent(event: DiscoveryEvent): Promise<void> {
    this.memoryEvents.set(event.id, event);
    const db = await this.db();
    if (!db) return;
    await putMany(db, EVENTS, [event]);
  }

  async getTokens(): Promise<DiscoveryTokenRecord[]> {
    const db = await this.db();
    if (!db) return [...this.memoryTokens.values()];
    return readAll<DiscoveryTokenRecord>(db, TOKENS);
  }

  async getEvents(limit = 500): Promise<DiscoveryEvent[]> {
    const db = await this.db();
    const events = db ? await readAll<DiscoveryEvent>(db, EVENTS) : [...this.memoryEvents.values()];
    return events.sort((a, b) => b.receivedAt - a.receivedAt).slice(0, limit);
  }

  async snapshot(): Promise<DiscoverySnapshot> {
    const tokens = await this.getTokens();
    const events = await this.getEvents(200);
    const watchCount = tokens.filter((t) => t.tier === "watch").length;
    const candidateCount = tokens.filter((t) => t.tier === "candidate").length;
    const subscribedMints = tokens.filter((t) => t.tier === "watch" || t.tier === "position").length;
    const lastEventAt = events[0]?.receivedAt ?? null;
    return {
      tokens,
      events,
      health: {
        status: "ok",
        lastEventAt,
        subscribedMints,
        candidateCount,
        watchCount,
      },
    };
  }

  async exportDataset(): Promise<DiscoveryDatasetExport> {
    return {
      version: 1,
      exportedAt: Date.now(),
      tokens: await this.getTokens(),
      events: await this.getEvents(Number.POSITIVE_INFINITY),
    };
  }

  async importDataset(data: DiscoveryDatasetExport): Promise<void> {
    for (const token of data.tokens) this.memoryTokens.set(token.mint, token);
    for (const event of data.events) this.memoryEvents.set(event.id, event);
    const db = await this.db();
    if (!db) return;
    await putMany(db, TOKENS, data.tokens);
    await putMany(db, EVENTS, data.events);
  }

  async clear(): Promise<void> {
    this.memoryTokens.clear();
    this.memoryEvents.clear();
    const db = await this.db();
    if (!db) return;
    await clearStore(db, TOKENS);
    await clearStore(db, EVENTS);
  }
}

export const discoveryStore = new DiscoveryStore();

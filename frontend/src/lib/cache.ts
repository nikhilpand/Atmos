// ─── ATMOS V2.0 — TTL Cache Utility ─────────────────────────────────
// Generic time-based cache with LRU eviction for server-side routes.

export interface TTLCache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  clear(): void;
  size(): number;
}

/**
 * Creates a bounded Map-based cache with TTL expiration and LRU eviction.
 * Uses Map insertion order for O(1) oldest-key eviction.
 */
export function createTTLCache<T>(ttlMs: number, maxEntries = 500): TTLCache<T> {
  const store = new Map<string, { data: T; ts: number }>();

  return {
    get(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.ts > ttlMs) {
        store.delete(key);
        return null;
      }
      // Move to end (refresh LRU position)
      store.delete(key);
      store.set(key, entry);
      return entry.data;
    },

    set(key: string, value: T): void {
      // Evict oldest entries if at capacity (O(1) — first key is oldest)
      while (store.size >= maxEntries) {
        const firstKey = store.keys().next().value;
        if (firstKey !== undefined) store.delete(firstKey);
        else break;
      }
      store.set(key, { data: value, ts: Date.now() });
    },

    clear(): void {
      store.clear();
    },

    size(): number {
      return store.size;
    },
  };
}


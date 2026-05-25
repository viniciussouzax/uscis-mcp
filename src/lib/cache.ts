/**
 * Simple TTL cache with optional stale-while-error fallback.
 *
 * Why we keep this in-process: every upstream we talk to (eCFR, egov, USCIS.gov)
 * is rate-friendly but slow. A 24h TTL on processing times completely matches
 * USCIS's own monthly publication cadence.
 */
export interface CacheEntry<T> {
  value: T;
  storedAt: number; // epoch ms
  ttlMs: number;
}

export class TTLCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, storedAt: Date.now(), ttlMs });
  }

  /** Returns fresh value, or null if expired/missing. */
  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > entry.ttlMs) {
      // expired but keep in map for stale fallback
      return null;
    }
    return entry.value;
  }

  /** Returns a possibly-stale value regardless of TTL. */
  getStale(key: string): { value: T; ageMs: number } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    return { value: entry.value, ageMs: Date.now() - entry.storedAt };
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// Single shared instance for the whole server
export const cache = new TTLCache();

// TTL presets in ms
export const TTL = {
  SIX_HOURS: 6 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
} as const;

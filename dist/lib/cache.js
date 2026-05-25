export class TTLCache {
    store = new Map();
    set(key, value, ttlMs) {
        this.store.set(key, { value, storedAt: Date.now(), ttlMs });
    }
    /** Returns fresh value, or null if expired/missing. */
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.storedAt > entry.ttlMs) {
            // expired but keep in map for stale fallback
            return null;
        }
        return entry.value;
    }
    /** Returns a possibly-stale value regardless of TTL. */
    getStale(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        return { value: entry.value, ageMs: Date.now() - entry.storedAt };
    }
    has(key) {
        return this.get(key) !== null;
    }
    delete(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
    size() {
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
};
//# sourceMappingURL=cache.js.map
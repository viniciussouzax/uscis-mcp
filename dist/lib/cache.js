/**
 * Entries are deliberately kept past their TTL so getStale can serve them when
 * an upstream is down, which means nothing ever left on its own. Under the
 * stdio transport the process is short-lived and that is harmless; under the
 * HTTP transport it is a long-running server holding eCFR parts of about a
 * megabyte each, a 57-page fee schedule and up to 456 policy manual chapters.
 * So the map is bounded and evicts least-recently-used entries.
 */
const DEFAULT_MAX_ENTRIES = 500;
export class TTLCache {
    maxEntries;
    store = new Map();
    constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
        this.maxEntries = maxEntries;
    }
    set(key, value, ttlMs) {
        const now = Date.now();
        this.store.set(key, { value, storedAt: now, lastUsed: now, ttlMs });
        this.evictIfNeeded();
    }
    /** Returns fresh value, or null if expired/missing. */
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        entry.lastUsed = Date.now();
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
        entry.lastUsed = Date.now();
        return { value: entry.value, ageMs: Date.now() - entry.storedAt };
    }
    /**
     * Drop least-recently-used entries once over the ceiling. Expired ones go
     * first: they are only worth keeping as a stale fallback, which is less
     * valuable than a live entry someone is still reading.
     */
    evictIfNeeded() {
        if (this.store.size <= this.maxEntries)
            return;
        const now = Date.now();
        const ranked = [...this.store.entries()].sort((a, b) => {
            const aExpired = now - a[1].storedAt > a[1].ttlMs ? 0 : 1;
            const bExpired = now - b[1].storedAt > b[1].ttlMs ? 0 : 1;
            if (aExpired !== bExpired)
                return aExpired - bExpired;
            return a[1].lastUsed - b[1].lastUsed;
        });
        for (const [key] of ranked.slice(0, this.store.size - this.maxEntries)) {
            this.store.delete(key);
        }
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
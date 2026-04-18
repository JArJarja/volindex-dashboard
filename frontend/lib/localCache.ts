// lib/localCache.ts
// Cache en mémoire côté client — évite que les données disparaissent pendant le rechargement

interface CacheEntry<T> {
  data: T;
  ts: number;
  ttl: number;
}

class LocalCache {
  private store = new Map<string, CacheEntry<any>>();

  set<T>(key: string, data: T, ttlMs = 60_000) {
    this.store.set(key, { data, ts: Date.now(), ttl: ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  // Retourne la valeur même expirée (stale) pour éviter flash vide
  getStale<T>(key: string): T | null {
    return (this.store.get(key)?.data as T) ?? null;
  }

  isStale(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return true;
    return Date.now() - entry.ts > entry.ttl;
  }
}

export const localCache = new LocalCache();

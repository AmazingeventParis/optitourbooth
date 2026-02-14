import { cacheHelpers } from '../config/redis.js';

/**
 * Wrapper générique pour cache avec pattern Cache-Aside
 * 1. Vérifie le cache
 * 2. Si hit → retourne les données
 * 3. Si miss → fetch depuis DB, met en cache, retourne
 */
export async function withCache<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  try {
    // 1. Vérifier cache
    const cached = await cacheHelpers.get<T>(key);
    if (cached !== null) {
      console.log(`[Cache HIT] ${key}`);
      return cached;
    }

    // 2. Cache MISS - fetch depuis DB
    console.log(`[Cache MISS] ${key}`);
    const data = await fetchFn();

    // 3. Mettre en cache (fire-and-forget)
    cacheHelpers.set(key, data, ttl).catch(err => {
      console.error(`[Cache SET error] ${key}:`, err);
    });

    return data;
  } catch (error) {
    console.error(`[Cache error] ${key}:`, error);
    // En cas d'erreur Redis, fallback sur DB directement
    return fetchFn();
  }
}

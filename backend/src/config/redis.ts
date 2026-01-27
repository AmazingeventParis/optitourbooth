import { Redis as IORedis } from 'ioredis';

// Configuration Redis
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: 1,
  retryStrategy(times: number) {
    if (times > 3) {
      // Stop retrying after 3 attempts
      return null;
    }
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true, // Don't connect immediately
};

// Track if Redis is available
let redisAvailable = false;

// Instance Redis principale
export const redis = new IORedis(redisConfig);

// Instance pour le subscriber (pub/sub)
export const redisSub = new IORedis(redisConfig);

// Try to connect to Redis (optional)
async function tryConnectRedis(): Promise<void> {
  try {
    await redis.connect();
    redisAvailable = true;
    console.log('✅ Connexion à Redis établie');
  } catch {
    redisAvailable = false;
    console.log('⚠️  Redis non disponible - fonctionnement sans cache');
  }
}

// Initialize Redis connection (non-blocking)
tryConnectRedis();

// Gestion des événements
redis.on('error', () => {
  // Silently ignore errors when Redis is not available
  redisAvailable = false;
});

redis.on('close', () => {
  redisAvailable = false;
});

// Helpers pour le cache (with fallback when Redis is not available)
export const cacheHelpers = {
  // Check if Redis is available
  isAvailable(): boolean {
    return redisAvailable;
  },

  // Stocker avec expiration (en secondes)
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!redisAvailable) return;
    try {
      const stringValue = JSON.stringify(value);
      if (ttlSeconds) {
        await redis.setex(key, ttlSeconds, stringValue);
      } else {
        await redis.set(key, stringValue);
      }
    } catch {
      // Ignore errors
    }
  },

  // Récupérer une valeur
  async get<T>(key: string): Promise<T | null> {
    if (!redisAvailable) return null;
    try {
      const value = await redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },

  // Supprimer une clé
  async del(key: string): Promise<void> {
    if (!redisAvailable) return;
    try {
      await redis.del(key);
    } catch {
      // Ignore errors
    }
  },

  // Vérifier si une clé existe
  async exists(key: string): Promise<boolean> {
    if (!redisAvailable) return false;
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch {
      return false;
    }
  },

  // Position chauffeur (temps réel)
  async setPosition(
    chauffeurId: string,
    position: { latitude: number; longitude: number; timestamp: number }
  ): Promise<void> {
    if (!redisAvailable) return;
    try {
      await redis.setex(
        `position:${chauffeurId}`,
        300, // 5 minutes d'expiration
        JSON.stringify(position)
      );
    } catch {
      // Ignore errors
    }
  },

  // Récupérer la position d'un chauffeur
  async getPosition(
    chauffeurId: string
  ): Promise<{ latitude: number; longitude: number; timestamp: number } | null> {
    return this.get(`position:${chauffeurId}`);
  },

  // Récupérer toutes les positions des chauffeurs actifs
  async getAllPositions(): Promise<
    Record<string, { latitude: number; longitude: number; timestamp: number }>
  > {
    if (!redisAvailable) return {};
    try {
      const keys = await redis.keys('position:*');
      const positions: Record<
        string,
        { latitude: number; longitude: number; timestamp: number }
      > = {};

      for (const key of keys) {
        const chauffeurId = key.replace('position:', '');
        const position = await this.getPosition(chauffeurId);
        if (position) {
          positions[chauffeurId] = position;
        }
      }

      return positions;
    } catch {
      return {};
    }
  },
};

// Fonction pour fermer les connexions Redis
export async function disconnectRedis(): Promise<void> {
  if (!redisAvailable) return;
  try {
    await redis.quit();
    await redisSub.quit();
    console.log('🔌 Déconnexion de Redis');
  } catch {
    // Ignore errors on disconnect
  }
}

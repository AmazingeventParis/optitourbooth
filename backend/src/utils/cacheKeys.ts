/**
 * Clés de cache standardisées pour Redis
 */
export const cacheKeys = {
  tournees: {
    list: (date: string, statut?: string) => `tournees:list:${date}:${statut || 'all'}`,
    byId: (id: string) => `tournee:${id}`,
  },
  users: {
    chauffeurs: () => 'users:chauffeurs:all',
    byId: (id: string) => `user:${id}`,
  },
  vehicules: {
    actifs: () => 'vehicules:actifs',
    all: () => 'vehicules:all',
  },
  produits: {
    actifs: () => 'produits:actifs',
    all: () => 'produits:all',
  },
};

/**
 * TTL (Time To Live) en secondes pour chaque type de cache
 */
export const cacheTTL = {
  tourneesList: 15 * 60,      // 15 min - données qui changent fréquemment
  tourneeById: 5 * 60,        // 5 min
  chauffeurs: 60 * 60,        // 1h - données relativement stables
  vehicules: 60 * 60,         // 1h
  produits: 60 * 60,          // 1h
  userById: 5 * 60,           // 5 min (auth)
};

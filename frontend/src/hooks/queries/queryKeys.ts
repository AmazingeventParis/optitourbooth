/**
 * Clés de cache React Query centralisées
 *
 * Structure hiérarchique pour permettre l'invalidation granulaire:
 * - queryKeys.tournees.all() -> invalide toutes les tournées
 * - queryKeys.tournees.lists() -> invalide toutes les listes
 * - queryKeys.tournees.list(filters) -> invalide une liste spécifique
 * - queryKeys.tournees.detail(id) -> invalide un détail spécifique
 */

export const queryKeys = {
  // Tournées
  tournees: {
    all: () => ['tournees'] as const,
    lists: () => [...queryKeys.tournees.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.tournees.lists(), filters] as const,
    details: () => [...queryKeys.tournees.all(), 'detail'] as const,
    detail: (id: string) => [...queryKeys.tournees.details(), id] as const,
    stats: (id: string) => [...queryKeys.tournees.detail(id), 'stats'] as const,
  },

  // Clients
  clients: {
    all: () => ['clients'] as const,
    lists: () => [...queryKeys.clients.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.clients.lists(), filters] as const,
    details: () => [...queryKeys.clients.all(), 'detail'] as const,
    detail: (id: string) => [...queryKeys.clients.details(), id] as const,
  },

  // Produits
  produits: {
    all: () => ['produits'] as const,
    lists: () => [...queryKeys.produits.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.produits.lists(), filters] as const,
    details: () => [...queryKeys.produits.all(), 'detail'] as const,
    detail: (id: string) => [...queryKeys.produits.details(), id] as const,
    options: () => [...queryKeys.produits.all(), 'options'] as const,
  },

  // Utilisateurs
  users: {
    all: () => ['users'] as const,
    lists: () => [...queryKeys.users.all(), 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.users.lists(), filters] as const,
    chauffeurs: () => [...queryKeys.users.all(), 'chauffeurs'] as const,
    details: () => [...queryKeys.users.all(), 'detail'] as const,
    detail: (id: string) => [...queryKeys.users.details(), id] as const,
  },

  // Dashboard / Stats
  dashboard: {
    all: () => ['dashboard'] as const,
    stats: () => [...queryKeys.dashboard.all(), 'stats'] as const,
  },
};

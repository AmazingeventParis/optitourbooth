import { cacheHelpers } from '../config/redis.js';
import { cacheKeys } from './cacheKeys.js';

/**
 * Invalide le cache des tournées pour une date donnée
 * Appelé lors de create/update/delete tournée
 */
export async function invalidateTourneesCache(date: string): Promise<void> {
  const keys = [
    cacheKeys.tournees.list(date),
    cacheKeys.tournees.list(date, 'brouillon'),
    cacheKeys.tournees.list(date, 'planifiee'),
    cacheKeys.tournees.list(date, 'en_cours'),
    cacheKeys.tournees.list(date, 'terminee'),
    cacheKeys.tournees.list(date, 'annulee'),
  ];

  await Promise.all(keys.map(k => cacheHelpers.del(k))).catch(err => {
    console.error('[Cache invalidation error]:', err);
  });

  console.log(`[Cache invalidated] tournees:${date}`);
}

/**
 * Invalide le cache d'une tournée spécifique
 */
export async function invalidateTourneeById(id: string): Promise<void> {
  await cacheHelpers.del(cacheKeys.tournees.byId(id));
  console.log(`[Cache invalidated] tournee:${id}`);
}

/**
 * Invalide le cache des chauffeurs
 * Appelé lors de create/update/delete chauffeur
 */
export async function invalidateChauffeurs(): Promise<void> {
  await cacheHelpers.del(cacheKeys.users.chauffeurs());
  console.log('[Cache invalidated] chauffeurs');
}

/**
 * Invalide le cache des véhicules
 */
export async function invalidateVehicules(): Promise<void> {
  await Promise.all([
    cacheHelpers.del(cacheKeys.vehicules.actifs()),
    cacheHelpers.del(cacheKeys.vehicules.all()),
  ]);
  console.log('[Cache invalidated] vehicules');
}

/**
 * Invalide le cache des produits
 */
export async function invalidateProduits(): Promise<void> {
  await Promise.all([
    cacheHelpers.del(cacheKeys.produits.actifs()),
    cacheHelpers.del(cacheKeys.produits.all()),
  ]);
  console.log('[Cache invalidated] produits');
}

import { config } from '../config/index.js';
import { cacheHelpers } from '../config/redis.js';
import crypto from 'crypto';

// TTL du cache OSRM (15 minutes - les routes changent rarement)
const OSRM_CACHE_TTL = 900;

// Générer une clé de cache basée sur les coordonnées
function generateCacheKey(prefix: string, coordinates: Coordinate[], options?: Record<string, unknown>): string {
  const coordStr = coordinates.map(c => `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`).join('|');
  const optStr = options ? JSON.stringify(options) : '';
  const hash = crypto.createHash('md5').update(coordStr + optStr).digest('hex').substring(0, 12);
  return `osrm:${prefix}:${hash}`;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface RouteStep {
  distance: number; // mètres
  duration: number; // secondes
  geometry?: string; // encoded polyline
}

interface RouteResult {
  distance: number; // mètres total
  duration: number; // secondes total
  geometry?: string; // encoded polyline
  legs: RouteStep[];
}

interface MatrixResult {
  distances: number[][]; // matrice des distances en mètres
  durations: number[][]; // matrice des durées en secondes
}

interface OptimizationResult {
  orderedIndices: number[];
  totalDistance: number;
  totalDuration: number;
  legs: RouteStep[];
  geometry?: string;
}

// Types pour les réponses OSRM
interface OSRMRouteResponse {
  code: string;
  message?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry?: string;
    legs: Array<{
      distance: number;
      duration: number;
    }>;
  }>;
}

interface OSRMMatrixResponse {
  code: string;
  message?: string;
  distances?: number[][];
  durations?: number[][];
}

interface OSRMTripResponse {
  code: string;
  message?: string;
  trips?: Array<{
    distance: number;
    duration: number;
    geometry?: string;
    legs: Array<{
      distance: number;
      duration: number;
    }>;
  }>;
  waypoints?: Array<{
    waypoint_index: number;
  }>;
}

// URL de base OSRM (utiliser le serveur public pour le développement)
// En production, utiliser une instance OSRM auto-hébergée
const OSRM_BASE_URL = config.osrm?.baseUrl || 'https://router.project-osrm.org';

/**
 * Service d'intégration OSRM (Open Source Routing Machine)
 * Documentation: http://project-osrm.org/docs/v5.24.0/api/
 */
export const osrmService = {
  /**
   * Calculer un itinéraire entre plusieurs points
   * @param coordinates Liste des coordonnées dans l'ordre
   * @param options Options supplémentaires
   */
  async getRoute(
    coordinates: Coordinate[],
    options: {
      overview?: 'full' | 'simplified' | 'false';
      steps?: boolean;
      alternatives?: boolean;
      skipCache?: boolean;
    } = {}
  ): Promise<RouteResult | null> {
    if (coordinates.length < 2) {
      return null;
    }

    const { overview = 'simplified', steps = false, alternatives = false, skipCache = false } = options;

    // Vérifier le cache si disponible
    const cacheKey = generateCacheKey('route', coordinates, { overview, steps, alternatives });
    if (!skipCache) {
      const cached = await cacheHelpers.get<RouteResult>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Format OSRM: longitude,latitude
    const coordsString = coordinates
      .map((c) => `${c.longitude},${c.latitude}`)
      .join(';');

    const url = `${OSRM_BASE_URL}/route/v1/driving/${coordsString}?overview=${overview}&steps=${steps}&alternatives=${alternatives}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.error('OSRM route error:', response.status, await response.text());
        return null;
      }

      const data = (await response.json()) as OSRMRouteResponse;

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        console.error('OSRM route error:', data.code, data.message);
        return null;
      }

      const route = data.routes[0];
      if (!route) {
        return null;
      }

      const result: RouteResult = {
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry,
        legs: route.legs.map((leg) => ({
          distance: leg.distance,
          duration: leg.duration,
        })),
      };

      // Mettre en cache le résultat
      await cacheHelpers.set(cacheKey, result, OSRM_CACHE_TTL);

      return result;
    } catch (error) {
      console.error('OSRM route fetch error:', error);
      return null;
    }
  },

  /**
   * Calculer la matrice des distances/durées entre tous les points
   * Utile pour l'optimisation
   */
  async getMatrix(coordinates: Coordinate[], skipCache = false): Promise<MatrixResult | null> {
    if (coordinates.length < 2) {
      return null;
    }

    // OSRM limite à 100 coordonnées pour la matrice
    if (coordinates.length > 100) {
      console.error('OSRM matrix limit exceeded (max 100 coordinates)');
      return null;
    }

    // Vérifier le cache
    const cacheKey = generateCacheKey('matrix', coordinates);
    if (!skipCache) {
      const cached = await cacheHelpers.get<MatrixResult>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Format OSRM: longitude,latitude
    const coordsString = coordinates
      .map((c) => `${c.longitude},${c.latitude}`)
      .join(';');

    const url = `${OSRM_BASE_URL}/table/v1/driving/${coordsString}?annotations=distance,duration`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.error('OSRM matrix error:', response.status, await response.text());
        return null;
      }

      const data = (await response.json()) as OSRMMatrixResponse;

      if (data.code !== 'Ok' || !data.distances || !data.durations) {
        console.error('OSRM matrix error:', data.code, data.message);
        return null;
      }

      const result: MatrixResult = {
        distances: data.distances,
        durations: data.durations,
      };

      // Mettre en cache
      await cacheHelpers.set(cacheKey, result, OSRM_CACHE_TTL);

      return result;
    } catch (error) {
      console.error('OSRM matrix fetch error:', error);
      return null;
    }
  },

  /**
   * Optimiser l'ordre des points avec OSRM Trip API
   * Résout le problème du voyageur de commerce (TSP)
   *
   * @param coordinates Points à visiter (le premier est considéré comme dépôt)
   * @param options Options d'optimisation
   */
  async optimizeRoute(
    coordinates: Coordinate[],
    options: {
      roundtrip?: boolean; // Retour au point de départ
      source?: 'first' | 'any'; // Point de départ
      destination?: 'last' | 'any'; // Point d'arrivée
      skipCache?: boolean;
    } = {}
  ): Promise<OptimizationResult | null> {
    if (coordinates.length < 2) {
      return null;
    }

    const { roundtrip = true, source = 'first', destination = 'last', skipCache = false } = options;

    // Vérifier le cache
    const cacheKey = generateCacheKey('trip', coordinates, { roundtrip, source, destination });
    if (!skipCache) {
      const cached = await cacheHelpers.get<OptimizationResult>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Format OSRM: longitude,latitude
    const coordsString = coordinates
      .map((c) => `${c.longitude},${c.latitude}`)
      .join(';');

    const params = new URLSearchParams({
      roundtrip: roundtrip.toString(),
      source,
      destination,
      overview: 'simplified',
      steps: 'false',
    });

    const url = `${OSRM_BASE_URL}/trip/v1/driving/${coordsString}?${params}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.error('OSRM trip error:', response.status, await response.text());
        return null;
      }

      const data = (await response.json()) as OSRMTripResponse;

      if (data.code !== 'Ok' || !data.trips || data.trips.length === 0 || !data.waypoints) {
        console.error('OSRM trip error:', data.code, data.message);
        return null;
      }

      const trip = data.trips[0];
      const waypoints = data.waypoints;

      if (!trip) {
        return null;
      }

      // Extraire l'ordre optimisé depuis les waypoints
      const orderedIndices = waypoints.map((wp) => wp.waypoint_index);

      const result: OptimizationResult = {
        orderedIndices,
        totalDistance: trip.distance,
        totalDuration: trip.duration,
        geometry: trip.geometry,
        legs: trip.legs.map((leg) => ({
          distance: leg.distance,
          duration: leg.duration,
        })),
      };

      // Mettre en cache
      await cacheHelpers.set(cacheKey, result, OSRM_CACHE_TTL);

      return result;
    } catch (error) {
      console.error('OSRM trip fetch error:', error);
      return null;
    }
  },

  /**
   * Calculer la distance et durée entre deux points
   */
  async getDistanceBetween(
    from: Coordinate,
    to: Coordinate
  ): Promise<{ distance: number; duration: number } | null> {
    const result = await this.getRoute([from, to]);

    if (!result) {
      return null;
    }

    return {
      distance: result.distance,
      duration: result.duration,
    };
  },

  /**
   * Vérifier si le service OSRM est disponible
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test avec une simple requête Paris -> Lyon
      const response = await fetch(
        `${OSRM_BASE_URL}/route/v1/driving/2.3522,48.8566;4.8357,45.7640?overview=false`
      );
      return response.ok;
    } catch {
      return false;
    }
  },
};

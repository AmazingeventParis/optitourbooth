import { config } from '../config/index.js';
import { cacheHelpers } from '../config/redis.js';
import crypto from 'crypto';

// TTL du cache VROOM (15 minutes)
const VROOM_CACHE_TTL = 900;

// Types pour l'API VROOM
interface VroomCoordinate {
  latitude: number;
  longitude: number;
}

interface VroomJob {
  id: number;
  description?: string;
  location: [number, number]; // [lon, lat]
  service?: number; // durée en secondes
  time_windows?: Array<[number, number]>; // [[start_sec, end_sec]]
  priority?: number; // 0-100, plus haut = plus prioritaire
  skills?: number[];
}

interface VroomVehicle {
  id: number;
  description?: string;
  start?: [number, number]; // [lon, lat]
  end?: [number, number]; // [lon, lat]
  time_window?: [number, number]; // [start_sec, end_sec]
  capacity?: number[];
  skills?: number[];
}

interface VroomRequest {
  vehicles: VroomVehicle[];
  jobs: VroomJob[];
  options?: {
    g?: boolean; // return geometry
  };
}

interface VroomStep {
  type: 'start' | 'job' | 'end';
  id?: number;
  location: [number, number];
  arrival: number; // secondes depuis minuit
  duration: number;
  service?: number;
  waiting_time?: number;
  distance?: number;
}

interface VroomRoute {
  vehicle: number;
  steps: VroomStep[];
  cost: number;
  duration: number;
  distance: number;
  waiting_time: number;
  service: number;
  geometry?: string;
}

interface VroomResponse {
  code: number; // 0 = success
  error?: string;
  summary?: {
    cost: number;
    routes: number;
    unassigned: number;
    distance: number;
    duration: number;
    waiting_time: number;
    service: number;
  };
  unassigned?: Array<{
    id: number;
    location: [number, number];
  }>;
  routes?: VroomRoute[];
}

export interface OptimizedJob {
  id: number;
  originalIndex: number;
  arrival: number; // secondes depuis minuit
  waitingTime: number;
  serviceTime: number;
  departureTime: number;
}

export interface VroomOptimizationResult {
  success: boolean;
  message: string;
  orderedJobs: OptimizedJob[];
  totalDistance: number; // mètres
  totalDuration: number; // secondes
  totalWaitingTime: number; // secondes
  totalServiceTime: number; // secondes
  unassignedJobs: number[];
  geometry?: string;
}

export interface PointToOptimize {
  id: string;
  index: number;
  latitude: number;
  longitude: number;
  dureePrevue: number; // minutes
  creneauDebut?: Date | null;
  creneauFin?: Date | null;
  priority?: number;
}

// Générer une clé de cache
function generateCacheKey(points: PointToOptimize[], depot: VroomCoordinate | null, heureDepart: Date): string {
  const pointsStr = points.map(p => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)},${p.dureePrevue}`).join('|');
  const depotStr = depot ? `${depot.latitude.toFixed(5)},${depot.longitude.toFixed(5)}` : 'nodepot';
  const hash = crypto.createHash('md5').update(pointsStr + depotStr + heureDepart.toISOString()).digest('hex').substring(0, 12);
  return `vroom:optimize:${hash}`;
}

// Convertir une heure en secondes depuis minuit
function timeToSeconds(date: Date): number {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

// Convertir une heure de créneau en secondes depuis minuit (en utilisant l'heure locale)
function creneauToSeconds(creneauDate: Date): number {
  const hours = creneauDate.getHours();
  const minutes = creneauDate.getMinutes();
  return hours * 3600 + minutes * 60;
}

/**
 * Service VROOM pour l'optimisation de tournées avec contraintes
 * Supporte:
 * - Time windows (créneaux horaires)
 * - Service times (durées d'installation/désinstallation)
 * - Multi-véhicules (optionnel)
 *
 * Peut utiliser:
 * - VROOM local (Docker): docker run -p 3000:3000 vroomvrp/vroom-express
 * - OpenRouteService API (cloud gratuit avec clé API)
 */
export const vroomService = {
  /**
   * Obtenir l'URL de base de VROOM
   */
  getBaseUrl(): string {
    // Priorité: VROOM local > OpenRouteService
    if (config.vroom?.baseUrl) {
      return config.vroom.baseUrl;
    }
    if (config.openRouteService?.apiKey) {
      return 'https://api.openrouteservice.org/optimization';
    }
    // Fallback sur VROOM local par défaut
    return 'http://localhost:3000';
  },

  /**
   * Vérifier si le service est disponible
   */
  async healthCheck(): Promise<{ available: boolean; service: string }> {
    const baseUrl = this.getBaseUrl();
    const isORS = baseUrl.includes('openrouteservice.org');

    try {
      if (isORS) {
        // OpenRouteService - vérifier via un appel simple
        const apiKey = config.openRouteService?.apiKey;
        if (!apiKey) {
          return { available: false, service: 'OpenRouteService (no API key)' };
        }
        // ORS ne fournit pas de health check simple, on suppose qu'il est disponible si on a la clé
        return { available: true, service: 'OpenRouteService' };
      } else {
        // VROOM local - tester un appel minimal
        const testRequest: VroomRequest = {
          vehicles: [{ id: 0, start: [2.35, 48.85] }],
          jobs: [{ id: 0, location: [2.36, 48.86] }],
        };

        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testRequest),
        });

        if (response.ok) {
          return { available: true, service: 'VROOM local' };
        }
        return { available: false, service: 'VROOM local (connection failed)' };
      }
    } catch (error) {
      return { available: false, service: `Error: ${error}` };
    }
  },

  /**
   * Optimiser une tournée avec VROOM
   * Prend en compte les créneaux horaires et durées de service
   */
  async optimizeTournee(
    points: PointToOptimize[],
    options: {
      depot?: VroomCoordinate | null;
      heureDepart: Date;
      heureFin?: Date | null;
      skipCache?: boolean;
    }
  ): Promise<VroomOptimizationResult> {
    const { depot, heureDepart, heureFin, skipCache = false } = options;

    if (points.length < 2) {
      return {
        success: false,
        message: 'Au moins 2 points sont nécessaires pour optimiser',
        orderedJobs: [],
        totalDistance: 0,
        totalDuration: 0,
        totalWaitingTime: 0,
        totalServiceTime: 0,
        unassignedJobs: [],
      };
    }

    // Vérifier le cache
    if (!skipCache) {
      const cacheKey = generateCacheKey(points, depot || null, heureDepart);
      const cached = await cacheHelpers.get<VroomOptimizationResult>(cacheKey);
      if (cached) {
        console.log('[VROOM] Cache hit');
        return cached;
      }
    }

    // Construire la requête VROOM
    const heureDepartSeconds = timeToSeconds(heureDepart);
    const heureFinSeconds = heureFin ? timeToSeconds(heureFin) : 86400; // Fin de journée par défaut

    // Véhicule (la tournée)
    const baseUrl = this.getBaseUrl();
    const isORS = baseUrl.includes('openrouteservice.org');

    const vehicle: VroomVehicle & { profile?: string } = {
      id: 0,
      time_window: [heureDepartSeconds, heureFinSeconds],
    };

    // OpenRouteService nécessite un profil de véhicule
    if (isORS) {
      vehicle.profile = 'driving-car';
    }

    // Point de départ (dépôt)
    if (depot && depot.latitude && depot.longitude) {
      vehicle.start = [depot.longitude, depot.latitude];
    } else if (points.length > 0 && points[0]) {
      // Si pas de dépôt, utiliser le premier point
      vehicle.start = [points[0].longitude, points[0].latitude];
    }

    // Jobs (points à visiter)
    const jobs: VroomJob[] = points.map((point, index) => {
      const job: VroomJob = {
        id: index,
        location: [point.longitude, point.latitude],
        service: point.dureePrevue * 60, // Convertir minutes en secondes
      };

      // Ajouter les créneaux horaires si définis
      if (point.creneauDebut || point.creneauFin) {
        const windowStart = point.creneauDebut
          ? creneauToSeconds(new Date(point.creneauDebut))
          : heureDepartSeconds;
        const windowEnd = point.creneauFin
          ? creneauToSeconds(new Date(point.creneauFin))
          : heureFinSeconds;

        // Vérifier que le créneau est valide
        if (windowStart < windowEnd) {
          job.time_windows = [[windowStart, windowEnd]];
        }
      }

      // Ajouter la priorité si définie
      if (point.priority !== undefined) {
        job.priority = point.priority;
      }

      return job;
    });

    const vroomRequest: VroomRequest = {
      vehicles: [vehicle],
      jobs,
      options: { g: true }, // Retourner la géométrie
    };

    // Appeler l'API
    const baseUrl = this.getBaseUrl();
    const isORS = baseUrl.includes('openrouteservice.org');

    try {
      console.log('[VROOM] Calling optimization API:', baseUrl);
      console.log('[VROOM] Request:', JSON.stringify(vroomRequest, null, 2));

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Ajouter l'API key pour OpenRouteService
      if (isORS && config.openRouteService?.apiKey) {
        headers['Authorization'] = `Bearer ${config.openRouteService.apiKey}`;
      }

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(vroomRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VROOM] API error:', response.status, errorText);
        return {
          success: false,
          message: `Erreur API VROOM: ${response.status} - ${errorText}`,
          orderedJobs: [],
          totalDistance: 0,
          totalDuration: 0,
          totalWaitingTime: 0,
          totalServiceTime: 0,
          unassignedJobs: [],
        };
      }

      const data = (await response.json()) as VroomResponse;
      console.log('[VROOM] Response:', JSON.stringify(data, null, 2));

      if (data.code !== 0) {
        return {
          success: false,
          message: `Erreur VROOM: ${data.error || 'Unknown error'}`,
          orderedJobs: [],
          totalDistance: 0,
          totalDuration: 0,
          totalWaitingTime: 0,
          totalServiceTime: 0,
          unassignedJobs: [],
        };
      }

      // Extraire les résultats
      const route = data.routes?.[0];
      if (!route) {
        return {
          success: false,
          message: 'Aucune route trouvée par VROOM',
          orderedJobs: [],
          totalDistance: 0,
          totalDuration: 0,
          totalWaitingTime: 0,
          totalServiceTime: 0,
          unassignedJobs: [],
        };
      }

      // Extraire l'ordre des jobs optimisés
      const orderedJobs: OptimizedJob[] = route.steps
        .filter(step => step.type === 'job' && step.id !== undefined)
        .map(step => ({
          id: step.id!,
          originalIndex: step.id!,
          arrival: step.arrival,
          waitingTime: step.waiting_time || 0,
          serviceTime: step.service || 0,
          departureTime: step.arrival + (step.waiting_time || 0) + (step.service || 0),
        }));

      // Jobs non assignés (impossibles à planifier)
      const unassignedJobs = data.unassigned?.map(u => u.id) || [];

      const result: VroomOptimizationResult = {
        success: true,
        message: unassignedJobs.length > 0
          ? `Optimisation terminée avec ${unassignedJobs.length} point(s) non assignable(s)`
          : 'Optimisation réussie',
        orderedJobs,
        totalDistance: route.distance || data.summary?.distance || 0,
        totalDuration: route.duration || data.summary?.duration || 0,
        totalWaitingTime: route.waiting_time || data.summary?.waiting_time || 0,
        totalServiceTime: route.service || data.summary?.service || 0,
        unassignedJobs,
        geometry: route.geometry,
      };

      // Mettre en cache le résultat
      if (!skipCache) {
        const cacheKey = generateCacheKey(points, depot || null, heureDepart);
        await cacheHelpers.set(cacheKey, result, VROOM_CACHE_TTL);
      }

      return result;
    } catch (error) {
      console.error('[VROOM] Fetch error:', error);
      return {
        success: false,
        message: `Erreur de connexion VROOM: ${error}`,
        orderedJobs: [],
        totalDistance: 0,
        totalDuration: 0,
        totalWaitingTime: 0,
        totalServiceTime: 0,
        unassignedJobs: [],
      };
    }
  },

  /**
   * Convertir les secondes depuis minuit en objet Date
   */
  secondsToDate(seconds: number, referenceDate: Date): Date {
    const result = new Date(referenceDate);
    result.setHours(0, 0, 0, 0);
    result.setSeconds(seconds);
    return result;
  },

  /**
   * Formater les secondes en heure lisible (HH:MM)
   */
  formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  },
};

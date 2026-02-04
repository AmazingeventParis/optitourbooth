import { config } from '../config/index.js';

interface TomTomRouteResponse {
  routes: Array<{
    summary: {
      lengthInMeters: number;
      travelTimeInSeconds: number;
      trafficDelayInSeconds: number;
      departureTime: string;
      arrivalTime: string;
    };
    legs: Array<{
      summary: {
        lengthInMeters: number;
        travelTimeInSeconds: number;
        trafficDelayInSeconds: number;
      };
    }>;
  }>;
}

interface TomTomMatrixResponse {
  matrix: Array<Array<{
    routeSummary?: {
      lengthInMeters: number;
      travelTimeInSeconds: number;
      trafficDelayInSeconds: number;
    };
  }>>;
}

interface RoutePoint {
  latitude: number;
  longitude: number;
}

interface RouteResult {
  distance: number; // mètres
  duration: number; // secondes (avec trafic)
  durationWithoutTraffic: number; // secondes (sans trafic)
  trafficDelay: number; // secondes de retard dû au trafic
  arrivalTime?: Date;
}

interface MatrixResult {
  durations: number[][]; // Matrice des durées en secondes
  distances: number[][]; // Matrice des distances en mètres
}

/**
 * Service TomTom pour le calcul d'itinéraires avec trafic en temps réel
 * Utilise les données historiques de trafic pour prédire les conditions
 * selon le jour et l'heure spécifiés
 */
export const tomtomService = {
  /**
   * Vérifier si TomTom est configuré
   */
  isConfigured(): boolean {
    return !!config.tomtom?.apiKey;
  },

  /**
   * Obtenir l'URL de base de l'API TomTom
   */
  getBaseUrl(): string {
    return 'https://api.tomtom.com';
  },

  /**
   * Calculer un itinéraire entre plusieurs points avec prise en compte du trafic
   * @param points Liste des points à visiter dans l'ordre
   * @param departureTime Heure de départ (pour le calcul du trafic prédictif)
   */
  async calculateRoute(
    points: RoutePoint[],
    departureTime: Date
  ): Promise<RouteResult | null> {
    if (!this.isConfigured()) {
      console.warn('[TOMTOM] API key not configured');
      return null;
    }

    if (points.length < 2) {
      return null;
    }

    const apiKey = config.tomtom!.apiKey;

    // Construire les coordonnées pour l'API
    // Format: lat,lon:lat,lon:lat,lon
    const coordinates = points
      .map(p => `${p.latitude},${p.longitude}`)
      .join(':');

    // Format ISO 8601 pour l'heure de départ
    const departAt = departureTime.toISOString();

    const url = `${this.getBaseUrl()}/routing/1/calculateRoute/${coordinates}/json?` +
      `key=${apiKey}` +
      `&departAt=${departAt}` +
      `&traffic=true` +
      `&travelMode=car` +
      `&routeType=fastest`;

    try {
      console.log(`[TOMTOM] Calculating route with traffic for ${points.length} points, departure: ${departAt}`);

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TOMTOM] API error: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json() as TomTomRouteResponse;

      if (!data.routes || data.routes.length === 0) {
        console.warn('[TOMTOM] No route found');
        return null;
      }

      const route = data.routes[0]!;
      const summary = route.summary;

      console.log(`[TOMTOM] Route calculated: ${summary.lengthInMeters}m, ${summary.travelTimeInSeconds}s (traffic delay: ${summary.trafficDelayInSeconds}s)`);

      return {
        distance: summary.lengthInMeters,
        duration: summary.travelTimeInSeconds,
        durationWithoutTraffic: summary.travelTimeInSeconds - summary.trafficDelayInSeconds,
        trafficDelay: summary.trafficDelayInSeconds,
        arrivalTime: new Date(summary.arrivalTime),
      };
    } catch (error) {
      console.error('[TOMTOM] Error calculating route:', error);
      return null;
    }
  },

  /**
   * Calculer les temps de trajet entre chaque paire de points (matrice)
   * Utile pour l'optimisation de tournées
   * @param origins Points d'origine
   * @param destinations Points de destination
   * @param departureTime Heure de départ
   */
  async calculateMatrix(
    origins: RoutePoint[],
    destinations: RoutePoint[],
    departureTime: Date
  ): Promise<MatrixResult | null> {
    if (!this.isConfigured()) {
      console.warn('[TOMTOM] API key not configured');
      return null;
    }

    const apiKey = config.tomtom!.apiKey;
    const departAt = departureTime.toISOString();

    // TomTom Matrix API
    const url = `${this.getBaseUrl()}/routing/1/matrix/json?key=${apiKey}`;

    const body = {
      origins: origins.map(p => ({ point: { latitude: p.latitude, longitude: p.longitude } })),
      destinations: destinations.map(p => ({ point: { latitude: p.latitude, longitude: p.longitude } })),
      options: {
        departAt,
        traffic: true,
        travelMode: 'car',
        routeType: 'fastest',
      },
    };

    try {
      console.log(`[TOMTOM] Calculating matrix ${origins.length}x${destinations.length}, departure: ${departAt}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TOMTOM] Matrix API error: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json() as TomTomMatrixResponse;

      // Convertir la réponse en matrices de durées et distances
      const durations: number[][] = [];
      const distances: number[][] = [];

      for (let i = 0; i < data.matrix.length; i++) {
        durations[i] = [];
        distances[i] = [];
        for (let j = 0; j < data.matrix[i]!.length; j++) {
          const cell = data.matrix[i]![j]!;
          durations[i]![j] = cell.routeSummary?.travelTimeInSeconds || 0;
          distances[i]![j] = cell.routeSummary?.lengthInMeters || 0;
        }
      }

      console.log(`[TOMTOM] Matrix calculated successfully`);

      return { durations, distances };
    } catch (error) {
      console.error('[TOMTOM] Error calculating matrix:', error);
      return null;
    }
  },

  /**
   * Calculer le temps de trajet entre deux points avec trafic
   */
  async calculateTravelTime(
    origin: RoutePoint,
    destination: RoutePoint,
    departureTime: Date
  ): Promise<{ duration: number; distance: number; trafficDelay: number } | null> {
    const result = await this.calculateRoute([origin, destination], departureTime);

    if (!result) return null;

    return {
      duration: result.duration,
      distance: result.distance,
      trafficDelay: result.trafficDelay,
    };
  },

  /**
   * Calculer les heures d'arrivée estimées pour une séquence de points
   * en tenant compte du trafic à chaque étape
   */
  async calculateArrivalTimes(
    points: Array<RoutePoint & { serviceDuration: number }>,
    departureTime: Date
  ): Promise<Array<{ arrivalTime: Date; departureTime: Date; travelTime: number; trafficDelay: number }> | null> {
    if (!this.isConfigured() || points.length < 2) {
      return null;
    }

    const results: Array<{ arrivalTime: Date; departureTime: Date; travelTime: number; trafficDelay: number }> = [];
    let currentTime = new Date(departureTime);

    // Premier point : arrivée = départ
    results.push({
      arrivalTime: new Date(currentTime),
      departureTime: new Date(currentTime.getTime() + points[0]!.serviceDuration * 60 * 1000),
      travelTime: 0,
      trafficDelay: 0,
    });

    currentTime = new Date(currentTime.getTime() + points[0]!.serviceDuration * 60 * 1000);

    // Pour chaque point suivant
    for (let i = 1; i < points.length; i++) {
      const origin = points[i - 1]!;
      const destination = points[i]!;

      // Calculer le temps de trajet avec le trafic prévu à cette heure
      const travelResult = await this.calculateTravelTime(
        { latitude: origin.latitude, longitude: origin.longitude },
        { latitude: destination.latitude, longitude: destination.longitude },
        currentTime
      );

      if (!travelResult) {
        console.warn(`[TOMTOM] Could not calculate travel time for leg ${i}`);
        return null;
      }

      // Arrivée = heure actuelle + temps de trajet
      const arrivalTime = new Date(currentTime.getTime() + travelResult.duration * 1000);

      // Départ du point = arrivée + durée de service
      const pointDepartureTime = new Date(arrivalTime.getTime() + destination.serviceDuration * 60 * 1000);

      results.push({
        arrivalTime,
        departureTime: pointDepartureTime,
        travelTime: travelResult.duration,
        trafficDelay: travelResult.trafficDelay,
      });

      currentTime = pointDepartureTime;
    }

    return results;
  },
};

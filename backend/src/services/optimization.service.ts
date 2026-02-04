import { prisma } from '../config/database.js';
import { osrmService } from './osrm.service.js';
import { vroomService, PointToOptimize } from './vroom.service.js';
import { config } from '../config/index.js';

interface PointWithCoords {
  id: string;
  ordre: number;
  latitude: number;
  longitude: number;
  dureePrevue: number;
  creneauDebut?: Date | null;
  creneauFin?: Date | null;
}

interface OptimizedPoint {
  id: string;
  ordre: number;
  heureArriveeEstimee: Date | null;
  distanceFromPrevious: number; // mètres
  durationFromPrevious: number; // secondes
}

interface TourneeStats {
  distanceTotaleKm: number;
  dureeTotaleMin: number;
  nombrePoints: number;
  heureFinEstimee: Date | null;
}

interface OptimizationOptions {
  respecterCreneaux?: boolean; // Essayer de respecter les créneaux horaires
  optimiserOrdre?: boolean; // Réorganiser l'ordre des points
}

/**
 * Service d'optimisation des tournées
 */
export const optimizationService = {
  /**
   * Calculer les statistiques d'une tournée (distance, durée, heures estimées)
   */
  async calculateTourneeStats(
    tourneeId: string,
    heureDepart?: Date | null
  ): Promise<TourneeStats | null> {
    // Récupérer la tournée avec ses points et le dépôt
    const tournee = await prisma.tournee.findUnique({
      where: { id: tourneeId },
      include: {
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            client: {
              select: { latitude: true, longitude: true },
            },
          },
        },
      },
    });

    if (!tournee) {
      return null;
    }

    const points = tournee.points;

    if (points.length === 0) {
      return {
        distanceTotaleKm: 0,
        dureeTotaleMin: 0,
        nombrePoints: 0,
        heureFinEstimee: null,
      };
    }

    // Construire la liste des coordonnées (dépôt + points)
    const coordinates: { latitude: number; longitude: number }[] = [];

    // Ajouter le dépôt si disponible
    if (tournee.depotLatitude && tournee.depotLongitude) {
      coordinates.push({
        latitude: tournee.depotLatitude,
        longitude: tournee.depotLongitude,
      });
    }

    // Ajouter les points avec coordonnées valides
    for (const point of points) {
      if (point.client.latitude && point.client.longitude) {
        coordinates.push({
          latitude: point.client.latitude,
          longitude: point.client.longitude,
        });
      }
    }

    // Si pas assez de points avec coordonnées, retourner des stats basiques
    if (coordinates.length < 2) {
      const totalDureePrevue = points.reduce((sum, p) => sum + p.dureePrevue, 0);
      return {
        distanceTotaleKm: 0,
        dureeTotaleMin: totalDureePrevue,
        nombrePoints: points.length,
        heureFinEstimee: null,
      };
    }

    // Calculer l'itinéraire avec OSRM
    const route = await osrmService.getRoute(coordinates);

    if (!route) {
      // Fallback sans données de route
      const totalDureePrevue = points.reduce((sum, p) => sum + p.dureePrevue, 0);
      return {
        distanceTotaleKm: 0,
        dureeTotaleMin: totalDureePrevue,
        nombrePoints: points.length,
        heureFinEstimee: null,
      };
    }

    // Calculer la durée totale de trajet
    const dureeTrajetMin = Math.ceil(route.duration / 60);
    const dureeSurPlaceMin = points.reduce((sum, p) => sum + p.dureePrevue, 0);

    // Calculer l'heure de fin avec la logique métier (attente aux créneaux)
    let heureFinEstimee: Date | null = null;
    let dureeTotaleMin = dureeTrajetMin + dureeSurPlaceMin;
    const startTime = heureDepart || tournee.heureDepart;

    if (startTime && route.legs) {
      let currentTime = new Date(startTime);

      // Parcourir chaque point pour calculer le temps réel avec attentes
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (!point) continue;

        const legIndex = tournee.depotLatitude ? i : (i > 0 ? i - 1 : -1);

        // Ajouter le temps de trajet
        if (legIndex >= 0 && legIndex < route.legs.length) {
          const leg = route.legs[legIndex];
          if (leg) {
            currentTime = new Date(currentTime.getTime() + leg.duration * 1000);
          }
        }

        // Si on arrive avant le créneau, on attend
        let serviceStartTime = new Date(currentTime);
        if (point.creneauDebut) {
          const creneauDebut = new Date(point.creneauDebut);
          // Utiliser getHours/setHours (heure locale) pour cohérence avec le stockage
          const creneauHours = creneauDebut.getHours();
          const creneauMinutes = creneauDebut.getMinutes();

          const creneauOnSameDay = new Date(currentTime);
          creneauOnSameDay.setHours(creneauHours, creneauMinutes, 0, 0);

          if (currentTime < creneauOnSameDay) {
            serviceStartTime = creneauOnSameDay;
          }
        }

        // Départ = début service + durée prévue
        currentTime = new Date(serviceStartTime.getTime() + point.dureePrevue * 60 * 1000);
      }

      heureFinEstimee = currentTime;

      // Recalculer la durée totale réelle
      dureeTotaleMin = Math.round((heureFinEstimee.getTime() - new Date(startTime).getTime()) / 60000);
    }

    return {
      distanceTotaleKm: Math.round(route.distance / 100) / 10, // Arrondi à 0.1 km
      dureeTotaleMin,
      nombrePoints: points.length,
      heureFinEstimee,
    };
  },

  /**
   * Calculer les heures d'arrivée estimées pour chaque point
   */
  async calculateEstimatedArrivals(
    tourneeId: string,
    heureDepart?: Date | null
  ): Promise<OptimizedPoint[]> {
    const tournee = await prisma.tournee.findUnique({
      where: { id: tourneeId },
      include: {
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            client: {
              select: { latitude: true, longitude: true },
            },
          },
        },
      },
    });

    if (!tournee || tournee.points.length === 0) {
      return [];
    }

    const points = tournee.points;
    const startTime = heureDepart || tournee.heureDepart;

    // Construire les coordonnées
    const coordinates: { latitude: number; longitude: number }[] = [];
    const pointsWithCoords: (typeof points[0] | null)[] = [];

    // Dépôt
    if (tournee.depotLatitude && tournee.depotLongitude) {
      coordinates.push({
        latitude: tournee.depotLatitude,
        longitude: tournee.depotLongitude,
      });
      pointsWithCoords.push(null); // Le dépôt n'est pas un point
    }

    // Points
    for (const point of points) {
      if (point.client.latitude && point.client.longitude) {
        coordinates.push({
          latitude: point.client.latitude,
          longitude: point.client.longitude,
        });
        pointsWithCoords.push(point);
      }
    }

    // Calculer l'itinéraire
    const route = await osrmService.getRoute(coordinates);

    const result: OptimizedPoint[] = [];
    let currentTime = startTime ? new Date(startTime) : null;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const legIndex = tournee.depotLatitude ? i : (i > 0 ? i - 1 : -1);

      let distanceFromPrevious = 0;
      let durationFromPrevious = 0;

      if (route && legIndex >= 0 && legIndex < route.legs.length) {
        const leg = route.legs[legIndex];
        if (leg) {
          distanceFromPrevious = leg.distance;
          durationFromPrevious = leg.duration;
        }
      }

      // Calculer l'heure d'arrivée
      let heureArriveeEstimee: Date | null = null;

      if (currentTime && point) {
        // Heure d'arrivée = heure de départ du point précédent + temps de trajet
        currentTime = new Date(currentTime.getTime() + durationFromPrevious * 1000);
        heureArriveeEstimee = new Date(currentTime);

        // LOGIQUE MÉTIER: Si on arrive en avance par rapport au créneau,
        // on attend le début du créneau avant de commencer le service.
        // Le départ vers le point suivant = max(heureArrivée, creneauDebut) + duréeService
        let serviceStartTime = new Date(currentTime);

        if (point.creneauDebut) {
          const creneauDebut = new Date(point.creneauDebut);
          // Extraire l'heure du créneau en HEURE LOCALE (cohérent avec le stockage via setHours)
          const creneauHours = creneauDebut.getHours();
          const creneauMinutes = creneauDebut.getMinutes();

          // Créer une date avec l'heure du créneau sur le même jour que currentTime
          const creneauOnSameDay = new Date(currentTime);
          creneauOnSameDay.setHours(creneauHours, creneauMinutes, 0, 0);

          // Si on arrive avant le début du créneau, on attend
          if (currentTime < creneauOnSameDay) {
            serviceStartTime = creneauOnSameDay;
          }
        }

        // Le départ vers le prochain point = début du service + durée prévue
        currentTime = new Date(serviceStartTime.getTime() + point.dureePrevue * 60 * 1000);
      }

      if (point) {
        result.push({
          id: point.id,
          ordre: point.ordre,
          heureArriveeEstimee,
          distanceFromPrevious,
          durationFromPrevious,
        });
      }
    }

    return result;
  },

  /**
   * Optimiser l'ordre des points d'une tournée
   * Utilise VROOM si disponible (avec support des créneaux horaires)
   * Sinon fallback sur OSRM (optimisation distance uniquement)
   */
  async optimizeTourneeOrder(
    tourneeId: string,
    options: OptimizationOptions = {}
  ): Promise<{ success: boolean; message: string; newOrder?: string[]; unassignedPoints?: string[] }> {
    const { respecterCreneaux = true, optimiserOrdre = true } = options;

    const tournee = await prisma.tournee.findUnique({
      where: { id: tourneeId },
      include: {
        points: {
          include: {
            client: {
              select: { latitude: true, longitude: true },
            },
          },
        },
      },
    });

    if (!tournee) {
      return { success: false, message: 'Tournée non trouvée' };
    }

    // Permettre l'optimisation des tournées en brouillon ou planifiées
    if (!['brouillon', 'planifiee'].includes(tournee.statut)) {
      return { success: false, message: 'Seules les tournées en brouillon ou planifiées peuvent être optimisées' };
    }

    if (tournee.points.length < 2) {
      return { success: false, message: 'Au moins 2 points sont nécessaires pour optimiser' };
    }

    // Filtrer les points avec coordonnées
    const pointsWithCoords = tournee.points.filter(
      (p) => p.client.latitude && p.client.longitude
    );

    if (pointsWithCoords.length < 2) {
      return { success: false, message: 'Pas assez de points géocodés pour optimiser' };
    }

    // Vérifier si VROOM est disponible et activé
    const useVroom = config.vroom?.enabled || config.openRouteService?.apiKey;

    if (useVroom) {
      // Utiliser VROOM pour une optimisation avec contraintes
      return this.optimizeWithVroom(tournee, pointsWithCoords, options);
    } else {
      // Fallback sur OSRM (optimisation distance uniquement)
      return this.optimizeWithOsrm(tournee, pointsWithCoords, options);
    }
  },

  /**
   * Optimisation avec VROOM (supporte créneaux horaires et durées de service)
   */
  async optimizeWithVroom(
    tournee: {
      id: string;
      heureDepart: Date | null;
      depotLatitude: number | null;
      depotLongitude: number | null;
      points: Array<{
        id: string;
        ordre: number;
        dureePrevue: number;
        creneauDebut: Date | null;
        creneauFin: Date | null;
        client: { latitude: number | null; longitude: number | null };
      }>;
    },
    pointsWithCoords: Array<{
      id: string;
      ordre: number;
      dureePrevue: number;
      creneauDebut: Date | null;
      creneauFin: Date | null;
      client: { latitude: number | null; longitude: number | null };
    }>,
    options: OptimizationOptions
  ): Promise<{ success: boolean; message: string; newOrder?: string[]; unassignedPoints?: string[] }> {
    const { optimiserOrdre = true } = options;

    console.log('[OPTIMIZATION] Utilisation de VROOM pour optimisation avec contraintes');

    // Préparer les points pour VROOM
    const vroomPoints: PointToOptimize[] = pointsWithCoords.map((point, index) => ({
      id: point.id,
      index,
      latitude: point.client.latitude!,
      longitude: point.client.longitude!,
      dureePrevue: point.dureePrevue,
      creneauDebut: point.creneauDebut,
      creneauFin: point.creneauFin,
    }));

    // Map pour retrouver l'ID du point par son index
    const indexToPointId = new Map<number, string>();
    pointsWithCoords.forEach((point, index) => {
      indexToPointId.set(index, point.id);
    });

    // Préparer le dépôt
    const depot = tournee.depotLatitude && tournee.depotLongitude
      ? { latitude: tournee.depotLatitude, longitude: tournee.depotLongitude }
      : null;

    // Heure de départ (défaut: 8h00)
    const heureDepart = tournee.heureDepart || new Date();
    if (!tournee.heureDepart) {
      heureDepart.setHours(8, 0, 0, 0);
    }

    // Appeler VROOM
    const result = await vroomService.optimizeTournee(vroomPoints, {
      depot,
      heureDepart,
    });

    if (!result.success) {
      console.warn('[OPTIMIZATION] VROOM a échoué, fallback sur OSRM:', result.message);
      // Fallback sur OSRM
      return this.optimizeWithOsrm(
        tournee as Parameters<typeof this.optimizeWithOsrm>[0],
        pointsWithCoords as Parameters<typeof this.optimizeWithOsrm>[1],
        options
      );
    }

    // Reconstruire l'ordre des points
    const newOrder: string[] = [];
    for (const job of result.orderedJobs) {
      const pointId = indexToPointId.get(job.originalIndex);
      if (pointId) {
        newOrder.push(pointId);
      }
    }

    // Points non assignables (créneaux impossibles)
    const unassignedPoints: string[] = [];
    for (const jobIndex of result.unassignedJobs) {
      const pointId = indexToPointId.get(jobIndex);
      if (pointId) {
        unassignedPoints.push(pointId);
        // Ajouter les points non assignés à la fin
        newOrder.push(pointId);
      }
    }

    // Ajouter les points sans coordonnées à la fin
    const pointsWithoutCoords = tournee.points.filter(
      (p) => !p.client.latitude || !p.client.longitude
    );
    for (const point of pointsWithoutCoords) {
      newOrder.push(point.id);
    }

    // Mettre à jour l'ordre en base
    if (optimiserOrdre && newOrder.length > 0) {
      await prisma.$transaction(
        newOrder.map((pointId, idx) =>
          prisma.point.update({
            where: { id: pointId },
            data: { ordre: idx },
          })
        )
      );

      // Recalculer les stats de la tournée
      await this.updateTourneeStats(tournee.id);
    }

    let message = 'Tournée optimisée avec VROOM (créneaux horaires respectés)';
    if (unassignedPoints.length > 0) {
      message += ` - ${unassignedPoints.length} point(s) avec créneaux impossibles`;
    }

    return {
      success: true,
      message,
      newOrder,
      unassignedPoints: unassignedPoints.length > 0 ? unassignedPoints : undefined,
    };
  },

  /**
   * Optimisation avec OSRM (optimisation distance uniquement, sans créneaux)
   */
  async optimizeWithOsrm(
    tournee: {
      id: string;
      depotLatitude: number | null;
      depotLongitude: number | null;
      points: Array<{
        id: string;
        client: { latitude: number | null; longitude: number | null };
      }>;
    },
    pointsWithCoords: Array<{
      id: string;
      client: { latitude: number | null; longitude: number | null };
    }>,
    options: OptimizationOptions
  ): Promise<{ success: boolean; message: string; newOrder?: string[] }> {
    const { optimiserOrdre = true } = options;

    console.log('[OPTIMIZATION] Utilisation de OSRM (optimisation distance uniquement)');

    // Construire les coordonnées pour OSRM
    const coordinates: { latitude: number; longitude: number }[] = [];

    // Ajouter le dépôt comme point de départ si disponible
    const hasDepot = tournee.depotLatitude && tournee.depotLongitude;
    if (hasDepot) {
      coordinates.push({
        latitude: tournee.depotLatitude!,
        longitude: tournee.depotLongitude!,
      });
    }

    // Map pour retrouver les points par index
    const pointIndexMap: Map<number, string> = new Map();

    pointsWithCoords.forEach((point, idx) => {
      const coordIndex = hasDepot ? idx + 1 : idx;
      pointIndexMap.set(coordIndex, point.id);
      coordinates.push({
        latitude: point.client.latitude!,
        longitude: point.client.longitude!,
      });
    });

    // Appeler OSRM pour optimiser
    const optimized = await osrmService.optimizeRoute(coordinates, {
      roundtrip: false,
      source: 'first',
      destination: 'any',
    });

    if (!optimized) {
      return { success: false, message: 'Échec de l\'optimisation OSRM' };
    }

    // Reconstruire l'ordre des points
    const newOrder: string[] = [];

    for (const index of optimized.orderedIndices) {
      // Ignorer le dépôt (index 0 si hasDepot)
      if (hasDepot && index === 0) continue;

      const pointId = pointIndexMap.get(index);
      if (pointId) {
        newOrder.push(pointId);
      }
    }

    // Ajouter les points sans coordonnées à la fin
    const pointsWithoutCoords = tournee.points.filter(
      (p) => !p.client.latitude || !p.client.longitude
    );
    for (const point of pointsWithoutCoords) {
      newOrder.push(point.id);
    }

    // Mettre à jour l'ordre en base
    if (optimiserOrdre) {
      await prisma.$transaction(
        newOrder.map((pointId, idx) =>
          prisma.point.update({
            where: { id: pointId },
            data: { ordre: idx },
          })
        )
      );

      // Recalculer les stats de la tournée
      await this.updateTourneeStats(tournee.id);
    }

    return {
      success: true,
      message: 'Tournée optimisée avec OSRM (distance uniquement, créneaux non pris en compte)',
      newOrder,
    };
  },

  /**
   * Mettre à jour les statistiques d'une tournée
   */
  async updateTourneeStats(tourneeId: string): Promise<void> {
    const stats = await this.calculateTourneeStats(tourneeId);

    if (stats) {
      const updateData: {
        distanceTotaleKm: number;
        dureeTotaleMin: number;
        nombrePoints: number;
        heureFinEstimee?: Date;
      } = {
        distanceTotaleKm: stats.distanceTotaleKm,
        dureeTotaleMin: stats.dureeTotaleMin,
        nombrePoints: stats.nombrePoints,
      };

      if (stats.heureFinEstimee) {
        updateData.heureFinEstimee = stats.heureFinEstimee;
      }

      await prisma.tournee.update({
        where: { id: tourneeId },
        data: updateData,
      });

      // Mettre à jour les heures d'arrivée estimées pour chaque point
      const arrivals = await this.calculateEstimatedArrivals(tourneeId);
      if (arrivals.length > 0) {
        await prisma.$transaction(
          arrivals
            .filter(a => a.heureArriveeEstimee !== null)
            .map(a =>
              prisma.point.update({
                where: { id: a.id },
                data: { heureArriveeEstimee: a.heureArriveeEstimee },
              })
            )
        );
      }
    }
  },

  /**
   * Calculer la durée prévue sur place pour un point
   * basée sur les produits et options sélectionnés
   */
  async calculatePointDuration(
    pointId: string
  ): Promise<number> {
    const point = await prisma.point.findUnique({
      where: { id: pointId },
      include: {
        produits: {
          include: {
            produit: true,
          },
        },
        options: {
          include: {
            option: true,
          },
        },
      },
    });

    if (!point) {
      return 30; // Durée par défaut
    }

    return this.calculateDurationFromPointData(point);
  },

  /**
   * Calculer les durées prévues pour plusieurs points en une seule requête
   * Optimisation pour éviter les N+1 queries
   */
  async calculatePointDurationsBatch(
    pointIds: string[]
  ): Promise<Map<string, number>> {
    if (pointIds.length === 0) {
      return new Map();
    }

    // Une seule requête pour récupérer tous les points avec leurs produits et options
    const points = await prisma.point.findMany({
      where: { id: { in: pointIds } },
      include: {
        produits: {
          include: {
            produit: true,
          },
        },
        options: {
          include: {
            option: true,
          },
        },
      },
    });

    const durations = new Map<string, number>();

    for (const point of points) {
      durations.set(point.id, this.calculateDurationFromPointData(point));
    }

    return durations;
  },

  /**
   * Calculer la durée à partir des données d'un point (helper interne)
   */
  calculateDurationFromPointData(
    point: {
      type: string;
      produits: Array<{
        quantite: number;
        produit: {
          dureeInstallation: number;
          dureeDesinstallation: number;
        };
      }>;
      options: Array<{
        option: {
          dureeSupp: number;
        };
      }>;
    }
  ): number {
    let duration = 0;

    // Calculer selon le type (livraison = installation, ramassage = désinstallation)
    for (const pp of point.produits) {
      const produit = pp.produit;
      const quantite = pp.quantite;

      if (point.type === 'livraison') {
        duration += produit.dureeInstallation * quantite;
      } else if (point.type === 'ramassage') {
        duration += produit.dureeDesinstallation * quantite;
      } else {
        // livraison_ramassage: les deux
        duration += (produit.dureeInstallation + produit.dureeDesinstallation) * quantite;
      }
    }

    // Ajouter les durées des options
    for (const po of point.options) {
      duration += po.option.dureeSupp;
    }

    return Math.max(duration, 15); // Minimum 15 minutes
  },

  /**
   * Mettre à jour les durées de tous les points d'une tournée en batch
   */
  async updateAllPointDurations(tourneeId: string): Promise<void> {
    // Récupérer tous les points de la tournée
    const points = await prisma.point.findMany({
      where: { tourneeId },
      select: { id: true },
    });

    if (points.length === 0) return;

    // Calculer toutes les durées en batch
    const pointIds = points.map(p => p.id);
    const durations = await this.calculatePointDurationsBatch(pointIds);

    // Mettre à jour tous les points en une seule transaction
    await prisma.$transaction(
      Array.from(durations.entries()).map(([pointId, dureePrevue]) =>
        prisma.point.update({
          where: { id: pointId },
          data: { dureePrevue },
        })
      )
    );
  },
};

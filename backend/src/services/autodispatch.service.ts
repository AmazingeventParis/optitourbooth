import { prisma } from '../config/database.js';
import { osrmService } from './osrm.service.js';
import { optimizationService } from './optimization.service.js';

interface PendingPoint {
  clientId: string;
  clientName: string;
  type: 'livraison' | 'ramassage' | 'livraison_ramassage';
  creneauDebut?: string;
  creneauFin?: string;
  produitIds?: string[];
  latitude?: number;
  longitude?: number;
  notes?: string;
  contactNom?: string;
  contactTelephone?: string;
}

interface TourneeCandidate {
  tourneeId: string;
  chauffeurId: string;
  chauffeurNom: string;
  currentPoints: number;
  totalDurationMin: number;
  heureDepart: Date | null;
  heureFinEstimee: Date | null;
  depotLatitude: number | null;
  depotLongitude: number | null;
  centroid: { lat: number; lng: number } | null;
}

interface DispatchResult {
  pointIndex: number;
  clientName: string;
  assignedTourneeId: string;
  chauffeurNom: string;
  reason: string;
  estimatedArrival?: string;
}

interface AutoDispatchResult {
  success: boolean;
  totalDispatched: number;
  totalFailed: number;
  dispatched: DispatchResult[];
  failed: Array<{ pointIndex: number; clientName: string; reason: string }>;
}

/**
 * Service d'auto-dispatch intelligent des points aux tournées
 */
export const autoDispatchService = {
  /**
   * Dispatcher automatiquement les points en attente vers les tournées existantes
   */
  async dispatchPendingPoints(
    date: string,
    pendingPoints: PendingPoint[]
  ): Promise<AutoDispatchResult> {
    const result: AutoDispatchResult = {
      success: true,
      totalDispatched: 0,
      totalFailed: 0,
      dispatched: [],
      failed: [],
    };

    if (pendingPoints.length === 0) {
      return result;
    }

    // Récupérer toutes les tournées du jour (brouillon ou planifiée)
    const tournees = await prisma.tournee.findMany({
      where: {
        date: new Date(date),
        statut: { in: ['brouillon', 'planifiee'] },
      },
      include: {
        chauffeur: { select: { id: true, nom: true, prenom: true } },
        points: {
          include: {
            client: { select: { latitude: true, longitude: true } },
            produits: { include: { produit: true } },
          },
        },
      },
    });

    if (tournees.length === 0) {
      // Aucune tournée disponible
      for (let i = 0; i < pendingPoints.length; i++) {
        result.failed.push({
          pointIndex: i,
          clientName: pendingPoints[i]!.clientName,
          reason: 'Aucune tournée disponible pour cette date',
        });
      }
      result.totalFailed = pendingPoints.length;
      result.success = false;
      return result;
    }

    // Préparer les candidats (tournées avec leurs infos)
    const tourneeCandidates: TourneeCandidate[] = tournees.map((t) => {
      const pointsWithCoords = t.points.filter(
        (p) => p.client.latitude && p.client.longitude
      );

      // Calculer le centroïde des points existants
      let centroid: { lat: number; lng: number } | null = null;
      if (pointsWithCoords.length > 0) {
        const sumLat = pointsWithCoords.reduce(
          (sum, p) => sum + (p.client.latitude || 0),
          0
        );
        const sumLng = pointsWithCoords.reduce(
          (sum, p) => sum + (p.client.longitude || 0),
          0
        );
        centroid = {
          lat: sumLat / pointsWithCoords.length,
          lng: sumLng / pointsWithCoords.length,
        };
      } else if (t.depotLatitude && t.depotLongitude) {
        centroid = { lat: t.depotLatitude, lng: t.depotLongitude };
      }

      return {
        tourneeId: t.id,
        chauffeurId: t.chauffeurId,
        chauffeurNom: `${t.chauffeur.prenom} ${t.chauffeur.nom}`,
        currentPoints: t.points.length,
        totalDurationMin: t.dureeTotaleMin || 0,
        heureDepart: t.heureDepart,
        heureFinEstimee: t.heureFinEstimee,
        depotLatitude: t.depotLatitude,
        depotLongitude: t.depotLongitude,
        centroid,
      };
    });

    // Récupérer les coordonnées des clients pour les points pending
    const clientIds = pendingPoints
      .filter((p) => p.clientId)
      .map((p) => p.clientId);

    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, latitude: true, longitude: true },
    });

    const clientCoordsMap = new Map(
      clients.map((c) => [c.id, { lat: c.latitude, lng: c.longitude }])
    );

    // Récupérer les infos des produits pour calculer les durées
    const allProduitIds = pendingPoints
      .flatMap((p) => p.produitIds || [])
      .filter(Boolean);

    const produits = await prisma.produit.findMany({
      where: { id: { in: allProduitIds } },
      select: { id: true, dureeInstallation: true, dureeDesinstallation: true },
    });

    const produitMap = new Map(produits.map((p) => [p.id, p]));

    // Dispatcher chaque point
    for (let i = 0; i < pendingPoints.length; i++) {
      const point = pendingPoints[i]!;
      const clientCoords = clientCoordsMap.get(point.clientId);

      // Vérifier que le client a des coordonnées
      if (!clientCoords?.lat || !clientCoords?.lng) {
        result.failed.push({
          pointIndex: i,
          clientName: point.clientName,
          reason: 'Client sans coordonnées GPS',
        });
        result.totalFailed++;
        continue;
      }

      // Calculer la durée prévue pour ce point
      const dureePrevue = this.calculatePointDuration(point, produitMap);

      // Trouver la meilleure tournée pour ce point
      const bestTournee = await this.findBestTournee(
        point,
        { lat: clientCoords.lat, lng: clientCoords.lng },
        dureePrevue,
        tourneeCandidates
      );

      if (!bestTournee) {
        result.failed.push({
          pointIndex: i,
          clientName: point.clientName,
          reason: 'Aucune tournée compatible trouvée',
        });
        result.totalFailed++;
        continue;
      }

      // Créer le point dans la tournée
      try {
        const newPoint = await prisma.point.create({
          data: {
            tourneeId: bestTournee.tourneeId,
            clientId: point.clientId,
            type: point.type,
            ordre: bestTournee.currentPoints, // Ajouter à la fin
            statut: 'a_faire',
            creneauDebut: point.creneauDebut ? this.parseTime(point.creneauDebut) : null,
            creneauFin: point.creneauFin ? this.parseTime(point.creneauFin) : null,
            dureePrevue,
            notesInternes: point.notes,
          },
        });

        // Ajouter les produits au point
        if (point.produitIds && point.produitIds.length > 0) {
          await prisma.pointProduit.createMany({
            data: point.produitIds.map((produitId) => ({
              pointId: newPoint.id,
              produitId,
              quantite: 1,
            })),
          });
        }

        // Mettre à jour le compteur de points pour ce candidat
        bestTournee.currentPoints++;
        bestTournee.totalDurationMin += dureePrevue;

        result.dispatched.push({
          pointIndex: i,
          clientName: point.clientName,
          assignedTourneeId: bestTournee.tourneeId,
          chauffeurNom: bestTournee.chauffeurNom,
          reason: bestTournee.reason || 'Optimisation géographique',
        });
        result.totalDispatched++;
      } catch (error) {
        result.failed.push({
          pointIndex: i,
          clientName: point.clientName,
          reason: `Erreur création: ${(error as Error).message}`,
        });
        result.totalFailed++;
      }
    }

    // Optimiser et recalculer les stats de chaque tournée modifiée
    const modifiedTourneeIds = new Set(
      result.dispatched.map((d) => d.assignedTourneeId)
    );

    for (const tourneeId of modifiedTourneeIds) {
      try {
        // Optimiser l'ordre des points
        await optimizationService.optimizeTourneeOrder(tourneeId, {
          respecterCreneaux: true,
          optimiserOrdre: true,
        });
      } catch (error) {
        console.error(`Erreur optimisation tournée ${tourneeId}:`, error);
      }
    }

    result.success = result.totalFailed === 0;
    return result;
  },

  /**
   * Trouver la meilleure tournée pour un point donné
   */
  async findBestTournee(
    point: PendingPoint,
    coords: { lat: number; lng: number },
    dureePrevue: number,
    candidates: TourneeCandidate[]
  ): Promise<(TourneeCandidate & { reason?: string }) | null> {
    if (candidates.length === 0) return null;

    // Scorer chaque tournée
    const scoredCandidates: Array<{
      candidate: TourneeCandidate;
      score: number;
      reason: string;
    }> = [];

    for (const candidate of candidates) {
      let score = 100; // Score de base
      let reasons: string[] = [];

      // 1. Score de proximité géographique (0-40 points)
      if (candidate.centroid) {
        const distance = this.haversineDistance(
          coords.lat,
          coords.lng,
          candidate.centroid.lat,
          candidate.centroid.lng
        );

        // Moins de 5km = max points, plus de 50km = 0 points
        const proximityScore = Math.max(0, 40 - (distance / 50) * 40);
        score += proximityScore;

        if (distance < 10) {
          reasons.push(`Proche (${distance.toFixed(1)}km)`);
        }
      }

      // 2. Score d'équilibrage de charge (0-30 points)
      // Favoriser les tournées avec moins de points
      const avgPoints = candidates.reduce((sum, c) => sum + c.currentPoints, 0) / candidates.length;
      if (candidate.currentPoints < avgPoints) {
        const loadScore = Math.min(30, (avgPoints - candidate.currentPoints) * 5);
        score += loadScore;
        reasons.push('Charge équilibrée');
      } else if (candidate.currentPoints > avgPoints + 3) {
        score -= 15; // Pénalité si tournée surchargée
      }

      // 3. Score de compatibilité horaire (0-30 points)
      if (point.creneauDebut && candidate.heureFinEstimee) {
        const creneauDebut = this.parseTime(point.creneauDebut);
        if (creneauDebut) {
          const creneauHour = creneauDebut.getHours();
          const finEstimeeHour = candidate.heureFinEstimee.getHours();

          // Si le créneau est après l'heure de fin estimée actuelle, c'est compatible
          if (creneauHour >= finEstimeeHour) {
            score += 20;
            reasons.push('Horaire compatible');
          } else if (creneauHour < finEstimeeHour - 2) {
            score -= 20; // Pénalité si le créneau est bien avant la fin actuelle
          }
        }
      }

      // 4. Bonus si la tournée n'est pas vide (meilleur pour l'optimisation)
      if (candidate.currentPoints > 0 && candidate.currentPoints < 10) {
        score += 10;
      }

      // 5. Pénalité si trop de points (éviter les tournées surchargées)
      if (candidate.currentPoints > 12) {
        score -= (candidate.currentPoints - 12) * 5;
      }

      scoredCandidates.push({
        candidate,
        score,
        reason: reasons.join(', ') || 'Affectation optimale',
      });
    }

    // Trier par score décroissant
    scoredCandidates.sort((a, b) => b.score - a.score);

    const best = scoredCandidates[0];
    if (best && best.score > 50) {
      return { ...best.candidate, reason: best.reason };
    }

    // Si aucun bon candidat, prendre le moins chargé
    const leastLoaded = candidates.reduce((min, c) =>
      c.currentPoints < min.currentPoints ? c : min
    );
    return { ...leastLoaded, reason: 'Tournée la moins chargée' };
  },

  /**
   * Calculer la durée prévue pour un point pending
   */
  calculatePointDuration(
    point: PendingPoint,
    produitMap: Map<string, { dureeInstallation: number; dureeDesinstallation: number }>
  ): number {
    let duration = 0;

    if (point.produitIds && point.produitIds.length > 0) {
      for (const produitId of point.produitIds) {
        const produit = produitMap.get(produitId);
        if (produit) {
          if (point.type === 'livraison') {
            duration += produit.dureeInstallation;
          } else if (point.type === 'ramassage') {
            duration += produit.dureeDesinstallation;
          } else {
            duration += produit.dureeInstallation + produit.dureeDesinstallation;
          }
        }
      }
    }

    return Math.max(duration, 15); // Minimum 15 minutes
  },

  /**
   * Parser une heure au format HH:MM en Date
   */
  parseTime(timeStr: string): Date | null {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const date = new Date();
    date.setHours(parseInt(match[1]!, 10), parseInt(match[2]!, 10), 0, 0);
    return date;
  },

  /**
   * Calculer la distance Haversine entre deux points (en km)
   */
  haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const R = 6371; // Rayon de la Terre en km
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  toRad(deg: number): number {
    return deg * (Math.PI / 180);
  },
};

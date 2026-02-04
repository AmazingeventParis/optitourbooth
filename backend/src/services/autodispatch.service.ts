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
      const bestResult = await this.findBestTournee(
        point,
        { lat: clientCoords.lat, lng: clientCoords.lng },
        dureePrevue,
        tourneeCandidates
      );

      if (!bestResult) {
        result.failed.push({
          pointIndex: i,
          clientName: point.clientName,
          reason: 'Aucune tournée compatible trouvée',
        });
        result.totalFailed++;
        continue;
      }

      const { candidate: bestTournee, reason } = bestResult;

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

        // Mettre à jour les stats du candidat pour les prochaines itérations
        // IMPORTANT: On modifie l'objet ORIGINAL dans le tableau tourneeCandidates
        bestTournee.currentPoints++;
        bestTournee.totalDurationMin += dureePrevue;

        // Recalculer le centroïde avec le nouveau point
        if (bestTournee.centroid) {
          const oldCount = bestTournee.currentPoints - 1;
          const newLat = (bestTournee.centroid.lat * oldCount + clientCoords.lat) / bestTournee.currentPoints;
          const newLng = (bestTournee.centroid.lng * oldCount + clientCoords.lng) / bestTournee.currentPoints;
          bestTournee.centroid = { lat: newLat, lng: newLng };
        } else {
          bestTournee.centroid = { lat: clientCoords.lat, lng: clientCoords.lng };
        }

        result.dispatched.push({
          pointIndex: i,
          clientName: point.clientName,
          assignedTourneeId: bestTournee.tourneeId,
          chauffeurNom: bestTournee.chauffeurNom,
          reason,
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
        // Optimiser l'ordre des points avec VROOM (créneaux + temps de trajet)
        console.log(`[AUTO-DISPATCH] Optimisation tournée ${tourneeId}...`);
        const optimResult = await optimizationService.optimizeTourneeOrder(tourneeId, {
          respecterCreneaux: true,
          optimiserOrdre: true,
        });
        console.log(`[AUTO-DISPATCH] Résultat optimisation: ${optimResult.success ? 'OK' : 'ÉCHEC'} - ${optimResult.message}`);
        if (optimResult.unassignedPoints && optimResult.unassignedPoints.length > 0) {
          console.log(`[AUTO-DISPATCH] Points non assignables: ${optimResult.unassignedPoints.join(', ')}`);
        }
      } catch (error) {
        console.error(`[AUTO-DISPATCH] Erreur optimisation tournée ${tourneeId}:`, error);
      }
    }

    result.success = result.totalFailed === 0;
    return result;
  },

  /**
   * Trouver la meilleure tournée pour un point donné
   * Utilise un algorithme d'équilibrage de charge strict
   * IMPORTANT: Retourne l'objet ORIGINAL du tableau candidates pour que les mises à jour
   * de currentPoints soient persistées entre les itérations
   */
  async findBestTournee(
    _point: PendingPoint,
    coords: { lat: number; lng: number },
    _dureePrevue: number,
    candidates: TourneeCandidate[]
  ): Promise<{ candidate: TourneeCandidate; reason: string } | null> {
    if (candidates.length === 0) return null;

    // STRATÉGIE: Équilibrage de charge strict
    // 1. Trouver le minimum de points
    // 2. Prendre TOUTES les tournées avec ce minimum
    // 3. Si plusieurs, choisir par proximité géographique
    // 4. Si égalité de distance, alterner (round-robin par index)

    const minPoints = Math.min(...candidates.map(c => c.currentPoints));

    // Filtrer les tournées qui ont le nombre minimum de points
    const leastLoadedCandidates = candidates.filter(c => c.currentPoints === minPoints);

    console.log(`[AUTO-DISPATCH] minPoints=${minPoints}, candidates avec min:`,
      leastLoadedCandidates.map(c => `${c.chauffeurNom}(${c.currentPoints}pts)`));

    // Si une seule tournée a le minimum, la retourner
    if (leastLoadedCandidates.length === 1) {
      const candidate = leastLoadedCandidates[0]!;
      console.log(`[AUTO-DISPATCH] Une seule tournée avec min -> ${candidate.chauffeurNom}`);
      return { candidate, reason: 'Équilibrage de charge' };
    }

    // Si plusieurs tournées ont le même nombre de points, choisir par proximité
    // En cas d'égalité de distance, on prend celui avec le moins de points TOTAL
    // ou en dernier recours, on alterne via l'index dans le tableau original
    let bestCandidate = leastLoadedCandidates[0]!;
    let bestDistance = Infinity;
    let bestIndex = candidates.indexOf(bestCandidate);

    for (const candidate of leastLoadedCandidates) {
      const candidateIndex = candidates.indexOf(candidate);
      let distance = Infinity;

      if (candidate.centroid) {
        distance = this.haversineDistance(
          coords.lat,
          coords.lng,
          candidate.centroid.lat,
          candidate.centroid.lng
        );
      }

      // Prendre si distance strictement meilleure
      // OU si distance égale mais moins de points totaux (durée plus courte)
      // OU si tout est égal, prendre l'index le plus bas pour garantir l'alternance
      const shouldReplace =
        distance < bestDistance ||
        (distance === bestDistance && candidate.totalDurationMin < bestCandidate.totalDurationMin) ||
        (distance === bestDistance && candidate.totalDurationMin === bestCandidate.totalDurationMin && candidateIndex < bestIndex);

      if (shouldReplace) {
        bestDistance = distance;
        bestCandidate = candidate;
        bestIndex = candidateIndex;
      }
    }

    const reason = bestDistance < Infinity
      ? `Équilibrage + proximité (${bestDistance.toFixed(1)}km)`
      : 'Équilibrage de charge';

    console.log(`[AUTO-DISPATCH] Choix final -> ${bestCandidate.chauffeurNom} (${reason})`);

    return { candidate: bestCandidate, reason };
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

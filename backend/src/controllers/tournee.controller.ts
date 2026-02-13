import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse, parsePagination } from '../utils/index.js';
import { optimizationService } from '../services/optimization.service.js';
import { geocodingService } from '../services/geocoding.service.js';
import { autoDispatchService } from '../services/autodispatch.service.js';
import { vroomService } from '../services/vroom.service.js';
import { config } from '../config/index.js';
import { notificationService } from '../services/notification.service.js';
import {
  CreateTourneeInput,
  UpdateTourneeInput,
  CreatePointInput,
  UpdatePointInput,
  ReorderPointsInput,
  MovePointInput,
  CreateIncidentInput,
} from '../validators/tournee.validator.js';
import { TourneeStatut, PointStatut } from '@prisma/client';

// Helper pour parser HH:MM en heures et minutes
function parseTime(timeStr: string): { hours: number; minutes: number } {
  const parts = timeStr.split(':');
  return {
    hours: parseInt(parts[0] || '0', 10),
    minutes: parseInt(parts[1] || '0', 10),
  };
}

// Helper pour récupérer une tournée complète avec tous les détails (utilisé après modifications)
async function getFullTournee(tourneeId: string) {
  return prisma.tournee.findUnique({
    where: { id: tourneeId },
    include: {
      chauffeur: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          telephone: true,
          email: true,
          couleur: true,
        },
      },
      vehicule: {
        select: {
          id: true,
          nom: true,
          marque: true,
          modele: true,
          immatriculation: true,
          consommationL100km: true,
        },
      },
      points: {
        orderBy: { ordre: 'asc' },
        include: {
          client: {
            select: {
              id: true,
              nom: true,
              adresse: true,
              codePostal: true,
              ville: true,
              latitude: true,
              longitude: true,
              telephone: true,
              contactNom: true,
              contactTelephone: true,
              instructionsAcces: true,
            },
          },
          produits: {
            select: {
              id: true,
              quantite: true,
              produit: {
                select: {
                  id: true,
                  nom: true,
                  couleur: true,
                  dureeInstallation: true,
                  dureeDesinstallation: true,
                },
              },
            },
          },
          options: {
            select: {
              option: {
                select: {
                  id: true,
                  nom: true,
                  dureeSupp: true,
                },
              },
            },
          },
          photos: {
            select: {
              id: true,
              filename: true,
              path: true,
              mimetype: true,
              size: true,
              type: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });
}

// Fonction pour auto-terminer les tournées en cours dont la date est passée
async function autoFinishPastTournees(): Promise<void> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    // Trouver toutes les tournées en_cours dont la date est passée
    const pastTournees = await prisma.tournee.findMany({
      where: {
        statut: 'en_cours',
        date: {
          lt: yesterday,
        },
      },
    });

    if (pastTournees.length > 0) {
      // Mettre à jour en masse
      await prisma.tournee.updateMany({
        where: {
          id: {
            in: pastTournees.map(t => t.id),
          },
        },
        data: {
          statut: 'terminee',
          heureFinReelle: new Date(),
        },
      });

      console.log(`[Auto-Finish] ${pastTournees.length} tournée(s) passée(s) automatiquement terminée(s)`);
    }
  } catch (error) {
    console.error('[Auto-Finish] Erreur:', error);
  }
}

export const tourneeController = {
  /**
   * GET /api/tournees
   * Liste des tournées avec pagination et filtres
   */
  async list(req: Request, res: Response): Promise<void> {
    // Auto-terminer les tournées en cours dont la date est passée
    await autoFinishPastTournees();

    const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });
    const { date, dateDebut, dateFin, chauffeurId, statut, includePoints } = req.query as {
      date?: string;
      dateDebut?: string;
      dateFin?: string;
      chauffeurId?: string;
      statut?: TourneeStatut;
      includePoints?: string;
    };

    // Construire les filtres
    const where: {
      date?: Date | { gte?: Date; lte?: Date };
      chauffeurId?: string;
      statut?: TourneeStatut;
    } = {};

    // Filtre par date exacte (plage du jour entier pour éviter les problèmes de timezone)
    if (date) {
      const dayStart = new Date(date + 'T00:00:00.000Z');
      const dayEnd = new Date(date + 'T23:59:59.999Z');
      where.date = { gte: dayStart, lte: dayEnd };
    }
    // Filtre par plage de dates
    else if (dateDebut || dateFin) {
      where.date = {};
      if (dateDebut) {
        where.date.gte = new Date(dateDebut);
      }
      if (dateFin) {
        where.date.lte = new Date(dateFin);
      }
    }

    if (chauffeurId) {
      where.chauffeurId = chauffeurId;
    }

    if (statut) {
      where.statut = statut;
    }

    // Exécuter la requête
    const baseOptions = { where, orderBy: [{ date: 'desc' as const }, { heureDepart: 'asc' as const }], skip, take: limit };

    const [tournees, total] = await Promise.all([
      includePoints === 'true'
        ? prisma.tournee.findMany({
            ...baseOptions,
            include: {
              chauffeur: { select: { id: true, nom: true, prenom: true, telephone: true, couleur: true } },
              vehicule: { select: { id: true, nom: true, marque: true, modele: true, immatriculation: true, consommationL100km: true } },
              _count: { select: { points: true } },
              points: {
                orderBy: { ordre: 'asc' },
                include: {
                  client: { select: { id: true, nom: true, societe: true, ville: true } },
                  produits: { include: { produit: { select: { id: true, nom: true } } } },
                },
              },
            },
          })
        : prisma.tournee.findMany({
            ...baseOptions,
            include: {
              chauffeur: { select: { id: true, nom: true, prenom: true, telephone: true, couleur: true } },
              vehicule: { select: { id: true, nom: true, marque: true, modele: true, immatriculation: true, consommationL100km: true } },
              _count: { select: { points: true } },
            },
          }),
      prisma.tournee.count({ where }),
    ]);

    apiResponse.paginated(res, tournees, { page, limit, total });
  },

  /**
   * GET /api/tournees/:id
   * Détails d'une tournée avec tous ses points
   * Paramètre ?light=true pour une version allégée (sans produits/options détaillés)
   */
  async getById(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const isLightMode = req.query.light === 'true';

    // Version allégée pour les listes et aperçus rapides
    if (isLightMode) {
      const tournee = await prisma.tournee.findUnique({
        where: { id },
        select: {
          id: true,
          date: true,
          statut: true,
          heureDepart: true,
          heureFinEstimee: true,
          heureFinReelle: true,
          distanceTotaleKm: true,
          dureeTotaleMin: true,
          nombrePoints: true,
          depotAdresse: true,
          depotLatitude: true,
          depotLongitude: true,
          notes: true,
          chauffeur: {
            select: {
              id: true,
              nom: true,
              prenom: true,
              telephone: true,
              couleur: true,
            },
          },
          vehicule: {
            select: {
              id: true,
              nom: true,
              marque: true,
              modele: true,
              immatriculation: true,
              consommationL100km: true,
            },
          },
          points: {
            orderBy: { ordre: 'asc' },
            select: {
              id: true,
              ordre: true,
              type: true,
              statut: true,
              dureePrevue: true,
              heureArriveeEstimee: true,
              creneauDebut: true,
              creneauFin: true,
              notesInternes: true,
              client: {
                select: {
                  id: true,
                  nom: true,
                  societe: true,
                  adresse: true,
                  codePostal: true,
                  ville: true,
                  latitude: true,
                  longitude: true,
                  telephone: true,
                  contactTelephone: true,
                },
              },
              produits: {
                select: {
                  quantite: true,
                  produit: { select: { id: true, nom: true } },
                },
              },
              _count: {
                select: {
                  options: true,
                  photos: true,
                  incidents: true,
                },
              },
            },
          },
        },
      });

      if (!tournee) {
        apiResponse.notFound(res, 'Tournée non trouvée');
        return;
      }

      apiResponse.success(res, tournee);
      return;
    }

    // Version complète avec tous les détails
    const tournee = await prisma.tournee.findUnique({
      where: { id },
      include: {
        chauffeur: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            telephone: true,
            email: true,
            couleur: true,
          },
        },
        vehicule: {
          select: {
            id: true,
            nom: true,
            marque: true,
            modele: true,
            immatriculation: true,
            consommationL100km: true,
          },
        },
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            client: {
              select: {
                id: true,
                nom: true,
                adresse: true,
                complementAdresse: true,
                codePostal: true,
                ville: true,
                latitude: true,
                longitude: true,
                telephone: true,
                email: true,
                contactNom: true,
                contactTelephone: true,
                instructionsAcces: true,
              },
            },
            produits: {
              select: {
                id: true,
                produitId: true,
                quantite: true,
                produit: {
                  select: {
                    id: true,
                    nom: true,
                    couleur: true,
                    dureeInstallation: true,
                    dureeDesinstallation: true,
                  },
                },
              },
            },
            options: {
              select: {
                option: {
                  select: {
                    id: true,
                    nom: true,
                    dureeSupp: true,
                  },
                },
              },
            },
            // Include photos for admin view
            photos: {
              select: {
                id: true,
                filename: true,
                path: true,
                mimetype: true,
                size: true,
                type: true,
                latitude: true,
                longitude: true,
                takenAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
            // Include incidents for admin view
            incidents: {
              select: {
                id: true,
                type: true,
                statut: true,
                description: true,
                resolution: true,
                photosUrls: true,
                dateDeclaration: true,
                dateResolution: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { dateDeclaration: 'desc' },
            },
          },
        },
      },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    apiResponse.success(res, tournee);
  },

  /**
   * POST /api/tournees
   * Créer une nouvelle tournée
   */
  async create(req: Request, res: Response): Promise<void> {
    const data = req.body as CreateTourneeInput;

    // Vérifier que le chauffeur existe et est actif
    const chauffeur = await prisma.user.findUnique({
      where: { id: data.chauffeurId },
    });

    if (!chauffeur || !chauffeur.actif || !chauffeur.roles.includes('chauffeur')) {
      apiResponse.badRequest(res, 'Chauffeur invalide ou inactif');
      return;
    }

    // Vérifier qu'il n'a pas déjà une tournée ce jour-là
    const checkDayStart = new Date(data.date + 'T00:00:00.000Z');
    const checkDayEnd = new Date(data.date + 'T23:59:59.999Z');
    const existingTournee = await prisma.tournee.findFirst({
      where: {
        chauffeurId: data.chauffeurId,
        date: { gte: checkDayStart, lte: checkDayEnd },
        statut: { not: 'annulee' },
      },
    });

    if (existingTournee) {
      apiResponse.conflict(res, 'Ce chauffeur a déjà une tournée planifiée ce jour-là');
      return;
    }

    // Préparer les données
    const createData: {
      date: Date;
      chauffeurId: string;
      vehiculeId?: string;
      heureDepart?: Date;
      depotAdresse?: string;
      depotLatitude?: number;
      depotLongitude?: number;
      notes?: string;
    } = {
      date: new Date(data.date),
      chauffeurId: data.chauffeurId,
    };

    if (data.vehiculeId) createData.vehiculeId = data.vehiculeId;

    if (data.heureDepart) {
      // Convertir HH:MM en Date (avec la date de la tournée) en HEURE LOCALE
      // pour cohérence avec les créneaux des points (aussi en heure locale)
      const { hours, minutes } = parseTime(data.heureDepart);
      const heureDepart = new Date(data.date);
      heureDepart.setHours(hours, minutes, 0, 0);
      createData.heureDepart = heureDepart;
    }

    if (data.depotAdresse) {
      createData.depotAdresse = data.depotAdresse;
      // Géocoder l'adresse du dépôt pour obtenir les coordonnées GPS
      // Essayer de parser l'adresse: "3, sentier des marécages 93100 Montreuil"
      const codePostalMatch = data.depotAdresse.match(/(\d{5})/);
      if (codePostalMatch && codePostalMatch[1]) {
        const codePostal = codePostalMatch[1];
        const codePostalIndex = data.depotAdresse.indexOf(codePostal);
        const adresse = data.depotAdresse.substring(0, codePostalIndex).trim().replace(/,\s*$/, '');
        const ville = data.depotAdresse.substring(codePostalIndex + 5).trim() || 'France';

        try {
          const geoResult = await geocodingService.geocodeAddress(adresse, codePostal, ville);
          if (geoResult) {
            createData.depotLatitude = geoResult.latitude;
            createData.depotLongitude = geoResult.longitude;
          }
        } catch (error) {
          console.warn('Erreur géocodage dépôt:', error);
        }
      }
    }
    if (data.depotLatitude) createData.depotLatitude = data.depotLatitude;
    if (data.depotLongitude) createData.depotLongitude = data.depotLongitude;
    if (data.notes) createData.notes = data.notes;

    const tournee = await prisma.tournee.create({
      data: createData,
      include: {
        chauffeur: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            couleur: true,
          },
        },
      },
    });

    // Fire-and-forget push notification
    notificationService.notifyTourneeCreated(data.chauffeurId, data.date, 0).catch(console.error);

    apiResponse.created(res, tournee, 'Tournée créée');
  },

  /**
   * PUT /api/tournees/:id
   * Modifier une tournée
   */
  async update(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const data = req.body as UpdateTourneeInput;

    // Vérifier que la tournée existe
    const tournee = await prisma.tournee.findUnique({
      where: { id },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    // Si modification du chauffeur
    if (data.chauffeurId && data.chauffeurId !== tournee.chauffeurId) {
      const chauffeur = await prisma.user.findUnique({
        where: { id: data.chauffeurId },
      });

      if (!chauffeur || !chauffeur.actif || !chauffeur.roles.includes('chauffeur')) {
        apiResponse.badRequest(res, 'Chauffeur invalide ou inactif');
        return;
      }

      // Vérifier la disponibilité
      const dateToCheck = data.date ? new Date(data.date) : tournee.date;
      const existingTournee = await prisma.tournee.findFirst({
        where: {
          chauffeurId: data.chauffeurId,
          date: dateToCheck,
          statut: { not: 'annulee' },
          id: { not: id },
        },
      });

      if (existingTournee) {
        apiResponse.conflict(res, 'Ce chauffeur a déjà une tournée planifiée ce jour-là');
        return;
      }
    }

    // Préparer les données de mise à jour
    const updateData: Record<string, unknown> = {};

    if (data.date) updateData.date = new Date(data.date);
    if (data.chauffeurId) updateData.chauffeurId = data.chauffeurId;
    if (data.vehiculeId !== undefined) updateData.vehiculeId = data.vehiculeId || null;
    if (data.statut) updateData.statut = data.statut;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.depotAdresse !== undefined) updateData.depotAdresse = data.depotAdresse;
    if (data.depotLatitude !== undefined) updateData.depotLatitude = data.depotLatitude;
    if (data.depotLongitude !== undefined) updateData.depotLongitude = data.depotLongitude;

    if (data.heureDepart !== undefined) {
      if (data.heureDepart) {
        const dateRef = data.date ? new Date(data.date) : tournee.date;
        const { hours, minutes } = parseTime(data.heureDepart);
        const heureDepart = new Date(dateRef);
        heureDepart.setHours(hours, minutes, 0, 0);
        updateData.heureDepart = heureDepart;
      } else {
        updateData.heureDepart = null;
      }
    }

    if (data.heureFinEstimee !== undefined) {
      if (data.heureFinEstimee) {
        const dateRef = data.date ? new Date(data.date) : tournee.date;
        const { hours, minutes } = parseTime(data.heureFinEstimee);
        const heureFin = new Date(dateRef);
        heureFin.setHours(hours, minutes, 0, 0);
        updateData.heureFinEstimee = heureFin;
      } else {
        updateData.heureFinEstimee = null;
      }
    }

    // Géocoder l'adresse du dépôt si:
    // 1. Une nouvelle adresse est fournie sans coordonnées
    // 2. Une adresse existe déjà mais les coordonnées sont manquantes
    const depotAdresseToGeocode = data.depotAdresse || (
      !tournee.depotLatitude && !tournee.depotLongitude && tournee.depotAdresse
        ? tournee.depotAdresse
        : null
    );

    if (depotAdresseToGeocode && data.depotLatitude === undefined && data.depotLongitude === undefined) {
      const codePostalMatch = depotAdresseToGeocode.match(/(\d{5})/);
      if (codePostalMatch && codePostalMatch[1]) {
        const codePostal = codePostalMatch[1];
        const codePostalIndex = depotAdresseToGeocode.indexOf(codePostal);
        const adresse = depotAdresseToGeocode.substring(0, codePostalIndex).trim().replace(/,\s*$/, '');
        const ville = depotAdresseToGeocode.substring(codePostalIndex + 5).trim() || 'France';

        try {
          const geoResult = await geocodingService.geocodeAddress(adresse, codePostal, ville);
          if (geoResult) {
            updateData.depotLatitude = geoResult.latitude;
            updateData.depotLongitude = geoResult.longitude;
          }
        } catch (error) {
          console.warn('Erreur géocodage dépôt:', error);
        }
      }
    }

    const updated = await prisma.tournee.update({
      where: { id },
      data: updateData,
      include: {
        chauffeur: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            couleur: true,
          },
        },
        _count: {
          select: { points: true },
        },
      },
    });

    // Fire-and-forget push notifications
    const tourneeDate = (data.date || tournee.date.toISOString()).split('T')[0]!;
    notificationService.notifyTourneeUpdated(updated.chauffeurId, tourneeDate, 'mise à jour générale').catch(console.error);
    // If chauffeur changed, notify the old chauffeur too
    if (data.chauffeurId && data.chauffeurId !== tournee.chauffeurId) {
      notificationService.notifyTourneeUpdated(tournee.chauffeurId, tourneeDate, 'réassignation à un autre chauffeur').catch(console.error);
    }

    apiResponse.success(res, updated, 'Tournée modifiée');
  },

  /**
   * DELETE /api/tournees/:id
   * Supprimer une tournée (tous statuts)
   */
  async delete(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const tournee = await prisma.tournee.findUnique({
      where: { id },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    // Supprimer la tournée (cascade supprimera les points)
    await prisma.tournee.delete({
      where: { id },
    });

    apiResponse.success(res, null, 'Tournée supprimée');
  },

  /**
   * POST /api/tournees/:id/cancel
   * Annuler une tournée
   */
  async cancel(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const tournee = await prisma.tournee.findUnique({
      where: { id },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    if (tournee.statut === 'terminee') {
      apiResponse.badRequest(res, 'Impossible d\'annuler une tournée terminée');
      return;
    }

    if (tournee.statut === 'annulee') {
      apiResponse.badRequest(res, 'Cette tournée est déjà annulée');
      return;
    }

    // Annuler la tournée et tous ses points
    await prisma.$transaction([
      prisma.point.updateMany({
        where: { tourneeId: id },
        data: { statut: 'annule' },
      }),
      prisma.tournee.update({
        where: { id },
        data: { statut: 'annulee' },
      }),
    ]);

    const updated = await prisma.tournee.findUnique({
      where: { id },
      include: {
        chauffeur: {
          select: { id: true, nom: true, prenom: true, couleur: true },
        },
      },
    });

    apiResponse.success(res, updated, 'Tournée annulée');
  },

  /**
   * POST /api/tournees/:id/duplicate
   * Dupliquer une tournée vers une nouvelle date
   */
  async duplicate(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const { newDate } = req.body as { newDate: string };

    if (!newDate) {
      apiResponse.badRequest(res, 'La nouvelle date est requise');
      return;
    }

    const tournee = await prisma.tournee.findUnique({
      where: { id },
      include: {
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            produits: true,
            options: true,
          },
        },
      },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    // Vérifier que le chauffeur n'a pas de tournée ce jour-là
    const existingTournee = await prisma.tournee.findFirst({
      where: {
        chauffeurId: tournee.chauffeurId,
        date: new Date(newDate),
        statut: { not: 'annulee' },
      },
    });

    if (existingTournee) {
      apiResponse.conflict(res, 'Ce chauffeur a déjà une tournée planifiée ce jour-là');
      return;
    }

    // Utiliser une transaction pour créer tout en batch (performance optimisée)
    const newTournee = await prisma.$transaction(async (tx) => {
      // 1. Créer la nouvelle tournée
      const created = await tx.tournee.create({
        data: {
          date: new Date(newDate),
          chauffeurId: tournee.chauffeurId,
          heureDepart: tournee.heureDepart
            ? new Date(new Date(newDate).setHours(
                tournee.heureDepart.getHours(),
                tournee.heureDepart.getMinutes()
              ))
            : null,
          depotAdresse: tournee.depotAdresse,
          depotLatitude: tournee.depotLatitude,
          depotLongitude: tournee.depotLongitude,
          notes: tournee.notes,
        },
      });

      // 2. Préparer les données des points pour createMany
      const pointsData = tournee.points.map((point) => ({
        tourneeId: created.id,
        clientId: point.clientId,
        type: point.type,
        ordre: point.ordre,
        creneauDebut: point.creneauDebut
          ? new Date(new Date(newDate).setHours(
              point.creneauDebut.getHours(),
              point.creneauDebut.getMinutes()
            ))
          : null,
        creneauFin: point.creneauFin
          ? new Date(new Date(newDate).setHours(
              point.creneauFin.getHours(),
              point.creneauFin.getMinutes()
            ))
          : null,
        dureePrevue: point.dureePrevue,
        notesInternes: point.notesInternes,
        notesClient: point.notesClient,
      }));

      // 3. Créer tous les points en une seule requête
      await tx.point.createMany({ data: pointsData });

      // 4. Récupérer les nouveaux points créés pour mapper les produits/options
      const newPoints = await tx.point.findMany({
        where: { tourneeId: created.id },
        orderBy: { ordre: 'asc' },
      });

      // 5. Créer un mapping ancien ordre -> nouveau point ID
      const orderToNewPointId = new Map<number, string>();
      newPoints.forEach((p) => orderToNewPointId.set(p.ordre, p.id));

      // 6. Préparer les données des produits en batch
      const produitsData: Array<{ pointId: string; produitId: string; quantite: number }> = [];
      for (const point of tournee.points) {
        const newPointId = orderToNewPointId.get(point.ordre);
        if (newPointId && point.produits.length > 0) {
          for (const p of point.produits) {
            produitsData.push({
              pointId: newPointId,
              produitId: p.produitId,
              quantite: p.quantite,
            });
          }
        }
      }

      // 7. Créer tous les produits en une seule requête
      if (produitsData.length > 0) {
        await tx.pointProduit.createMany({ data: produitsData });
      }

      // 8. Préparer les données des options en batch
      const optionsData: Array<{ pointId: string; optionId: string }> = [];
      for (const point of tournee.points) {
        const newPointId = orderToNewPointId.get(point.ordre);
        if (newPointId && point.options.length > 0) {
          for (const o of point.options) {
            optionsData.push({
              pointId: newPointId,
              optionId: o.optionId,
            });
          }
        }
      }

      // 9. Créer toutes les options en une seule requête
      if (optionsData.length > 0) {
        await tx.pointOption.createMany({ data: optionsData });
      }

      return created;
    });

    // Mettre à jour les stats de la nouvelle tournée (hors transaction pour ne pas bloquer)
    await optimizationService.updateTourneeStats(newTournee.id);

    const result = await prisma.tournee.findUnique({
      where: { id: newTournee.id },
      include: {
        chauffeur: {
          select: { id: true, nom: true, prenom: true, couleur: true },
        },
        points: {
          orderBy: { ordre: 'asc' },
          include: { client: true },
        },
      },
    });

    apiResponse.created(res, result, 'Tournée dupliquée');
  },

  /**
   * GET /api/tournees/:id/stats
   * Obtenir les statistiques de la tournée
   */
  async getStats(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const tournee = await prisma.tournee.findUnique({
      where: { id },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    const stats = await optimizationService.calculateTourneeStats(id);

    apiResponse.success(res, stats);
  },

  /**
   * POST /api/tournees/:id/optimize
   * Optimiser l'ordre des points
   */
  async optimize(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const result = await optimizationService.optimizeTourneeOrder(id);

    if (!result.success) {
      apiResponse.badRequest(res, result.message);
      return;
    }

    // Récupérer la tournée mise à jour
    const tournee = await prisma.tournee.findUnique({
      where: { id },
      include: {
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            client: {
              select: {
                id: true,
                nom: true,
                adresse: true,
                ville: true,
              },
            },
          },
        },
      },
    });

    apiResponse.success(res, tournee, result.message);
  },

  /**
   * POST /api/tournees/:id/start
   * Démarrer une tournée
   */
  async start(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const tournee = await prisma.tournee.findUnique({
      where: { id },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    if (tournee.statut !== 'planifiee') {
      apiResponse.badRequest(res, 'Cette tournée ne peut pas être démarrée');
      return;
    }

    const updated = await prisma.tournee.update({
      where: { id },
      data: {
        statut: 'en_cours',
        heureDepart: new Date(),
      },
    });

    apiResponse.success(res, updated, 'Tournée démarrée');
  },

  /**
   * POST /api/tournees/:id/finish
   * Terminer une tournée
   */
  async finish(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const tournee = await prisma.tournee.findUnique({
      where: { id },
      include: {
        points: {
          where: {
            statut: { in: ['a_faire', 'en_cours'] },
          },
        },
      },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    if (tournee.statut !== 'en_cours') {
      apiResponse.badRequest(res, 'Cette tournée n\'est pas en cours');
      return;
    }

    // Vérifier que tous les points sont terminés
    if (tournee.points.length > 0) {
      apiResponse.badRequest(
        res,
        `${tournee.points.length} point(s) non terminé(s). Veuillez les compléter ou les annuler.`
      );
      return;
    }

    const updated = await prisma.tournee.update({
      where: { id },
      data: {
        statut: 'terminee',
        heureFinReelle: new Date(),
      },
    });

    apiResponse.success(res, updated, 'Tournée terminée');
  },

  /**
   * GET /api/tournees/:id/route
   * Obtenir l'itinéraire calculé
   */
  async getRoute(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const tournee = await prisma.tournee.findUnique({
      where: { id },
      include: {
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            client: {
              select: {
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    // Calculer les heures d'arrivée estimées
    const arrivals = await optimizationService.calculateEstimatedArrivals(id);

    // Calculer les stats
    const stats = await optimizationService.calculateTourneeStats(id);

    apiResponse.success(res, {
      tourneeId: id,
      depot: {
        adresse: tournee.depotAdresse,
        latitude: tournee.depotLatitude,
        longitude: tournee.depotLongitude,
      },
      points: arrivals,
      stats,
    });
  },

  /**
   * GET /api/tournees/:id/debug
   * Diagnostic des temps de trajet pour une tournée
   */
  async debugRoute(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const tournee = await prisma.tournee.findUnique({
      where: { id },
      include: {
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            client: {
              select: { id: true, nom: true, latitude: true, longitude: true, adresse: true },
            },
          },
        },
      },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    const debug: {
      tourneeId: string;
      depot: { adresse: string | null; latitude: number | null; longitude: number | null };
      heureDepart: Date | null;
      points: Array<{
        ordre: number;
        clientNom: string;
        clientAdresse: string | null;
        latitude: number | null;
        longitude: number | null;
        dureePrevue: number;
        creneauDebut: Date | null;
        creneauFin: Date | null;
      }>;
      osrmTest: {
        success: boolean;
        error?: string;
        distance?: number;
        duration?: number;
        legs?: Array<{ distance: number; duration: number }>;
      } | null;
      tomtomConfigured: boolean;
    } = {
      tourneeId: id,
      depot: {
        adresse: tournee.depotAdresse,
        latitude: tournee.depotLatitude,
        longitude: tournee.depotLongitude,
      },
      heureDepart: tournee.heureDepart,
      points: tournee.points.map(p => ({
        ordre: p.ordre,
        clientNom: p.client.nom,
        clientAdresse: p.client.adresse,
        latitude: p.client.latitude,
        longitude: p.client.longitude,
        dureePrevue: p.dureePrevue,
        creneauDebut: p.creneauDebut,
        creneauFin: p.creneauFin,
      })),
      osrmTest: null,
      tomtomConfigured: !!config.tomtom?.apiKey,
    };

    // Tester OSRM avec les coordonnées réelles
    const coordinates: Array<{ latitude: number; longitude: number }> = [];

    if (tournee.depotLatitude && tournee.depotLongitude) {
      coordinates.push({ latitude: tournee.depotLatitude, longitude: tournee.depotLongitude });
    }

    for (const point of tournee.points) {
      if (point.client.latitude && point.client.longitude) {
        coordinates.push({ latitude: point.client.latitude, longitude: point.client.longitude });
      }
    }

    if (coordinates.length >= 2) {
      try {
        const { osrmService } = await import('../services/osrm.service.js');
        const route = await osrmService.getRoute(coordinates, { skipCache: true });

        if (route) {
          debug.osrmTest = {
            success: true,
            distance: route.distance,
            duration: route.duration,
            legs: route.legs,
          };
        } else {
          debug.osrmTest = {
            success: false,
            error: 'OSRM returned null',
          };
        }
      } catch (error) {
        debug.osrmTest = {
          success: false,
          error: (error as Error).message,
        };
      }
    } else {
      debug.osrmTest = {
        success: false,
        error: `Not enough coordinates: ${coordinates.length} (need at least 2)`,
      };
    }

    apiResponse.success(res, debug);
  },

  // ========== POINTS ==========

  /**
   * POST /api/tournees/:id/points
   * Ajouter un point à la tournée
   */
  async addPoint(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const data = req.body as CreatePointInput;

    // Vérifier que la tournée existe et est modifiable
    const tournee = await prisma.tournee.findUnique({
      where: { id },
      include: {
        _count: { select: { points: true } },
      },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    if (tournee.statut !== 'planifiee' && tournee.statut !== 'brouillon') {
      apiResponse.badRequest(res, 'Cette tournée ne peut plus être modifiée');
      return;
    }

    // Vérifier le client
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
    });

    if (!client || !client.actif) {
      apiResponse.badRequest(res, 'Client invalide ou inactif');
      return;
    }

    // Vérifier les produits
    const produitIds = data.produits.map((p) => p.produitId);
    const produits = await prisma.produit.findMany({
      where: { id: { in: produitIds }, actif: true },
    });

    if (produits.length !== produitIds.length) {
      apiResponse.badRequest(res, 'Un ou plusieurs produits sont invalides');
      return;
    }

    // Vérifier les options si fournies
    if (data.options && data.options.length > 0) {
      const optionIds = data.options.map((o) => o.optionId);
      const options = await prisma.produitOption.findMany({
        where: { id: { in: optionIds }, actif: true },
      });

      if (options.length !== optionIds.length) {
        apiResponse.badRequest(res, 'Une ou plusieurs options sont invalides');
        return;
      }
    }

    // Ordre = dernier + 1
    const ordre = tournee._count.points;

    // Préparer les données
    const pointData: {
      tourneeId: string;
      clientId: string;
      type: typeof data.type;
      ordre: number;
      creneauDebut?: Date;
      creneauFin?: Date;
      notesInternes?: string;
      notesClient?: string;
      dureePrevue: number;
    } = {
      tourneeId: id,
      clientId: data.clientId,
      type: data.type,
      ordre,
      dureePrevue: 30, // Sera recalculé
    };

    if (data.creneauDebut) {
      const { hours: h, minutes: m } = parseTime(data.creneauDebut);
      const d = new Date(tournee.date);
      d.setHours(h, m, 0, 0);
      pointData.creneauDebut = d;
    }

    if (data.creneauFin) {
      const { hours: h, minutes: m } = parseTime(data.creneauFin);
      const d = new Date(tournee.date);
      d.setHours(h, m, 0, 0);
      pointData.creneauFin = d;
    }

    if (data.notesInternes) pointData.notesInternes = data.notesInternes;
    if (data.notesClient) pointData.notesClient = data.notesClient;

    // Créer le point avec ses produits et options
    const point = await prisma.point.create({
      data: {
        ...pointData,
        produits: {
          create: data.produits.map((p) => ({
            produitId: p.produitId,
            quantite: p.quantite,
          })),
        },
        options: data.options
          ? {
              create: data.options.map((o) => ({
                optionId: o.optionId,
              })),
            }
          : undefined,
      },
      include: {
        client: true,
        produits: {
          include: { produit: true },
        },
        options: {
          include: { option: true },
        },
      },
    });

    // Calculer la durée prévue
    const dureePrevue = await optimizationService.calculatePointDuration(point.id);

    await prisma.point.update({
      where: { id: point.id },
      data: { dureePrevue },
    });

    // Mettre à jour les stats de la tournée (calcule les ETAs avec OSRM)
    await optimizationService.updateTourneeStats(id);

    // Fire-and-forget push notification
    notificationService.notifyPointAdded(
      tournee.chauffeurId,
      tournee.date.toISOString(),
      client.nom
    ).catch(console.error);

    // Retourner la tournée complète avec tous les points et leurs ETAs
    const updatedTournee = await getFullTournee(id);
    apiResponse.created(res, updatedTournee, 'Point ajouté');
  },

  /**
   * PUT /api/tournees/:id/points/:pointId
   * Modifier un point
   */
  async updatePoint(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const pointId = req.params.pointId as string;
    const data = req.body as UpdatePointInput;

    // Vérifier que le point existe et appartient à la tournée
    const point = await prisma.point.findFirst({
      where: { id: pointId, tourneeId: id },
      include: { tournee: true },
    });

    if (!point) {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }

    // Vérifications selon le statut
    if (point.tournee.statut === 'terminee' || point.tournee.statut === 'annulee') {
      apiResponse.badRequest(res, 'Cette tournée ne peut plus être modifiée');
      return;
    }

    // Préparer les données
    const updateData: Record<string, unknown> = {};

    if (data.clientId) {
      const client = await prisma.client.findUnique({ where: { id: data.clientId } });
      if (!client || !client.actif) {
        apiResponse.badRequest(res, 'Client invalide');
        return;
      }
      updateData.clientId = data.clientId;
    }

    if (data.type) updateData.type = data.type;
    if (data.ordre !== undefined) updateData.ordre = data.ordre;
    if (data.notesInternes !== undefined) updateData.notesInternes = data.notesInternes;
    if (data.notesClient !== undefined) updateData.notesClient = data.notesClient;

    // Signature client
    if (data.signatureData !== undefined) {
      updateData.signatureData = data.signatureData;
      updateData.signatureDate = data.signatureData ? new Date() : null;
    }
    if (data.signatureNom !== undefined) updateData.signatureNom = data.signatureNom;

    // Gestion du changement de statut avec horodatage
    if (data.statut) {
      updateData.statut = data.statut;
      // Si on passe en_cours, enregistrer l'heure d'arrivée réelle
      if (data.statut === 'en_cours' && point.statut === 'a_faire') {
        updateData.heureArriveeReelle = new Date();
      }
      // Si on termine ou incident, enregistrer l'heure de départ
      if ((data.statut === 'termine' || data.statut === 'incident') && point.statut === 'en_cours') {
        updateData.heureDepartReelle = new Date();
      }
    }

    if (data.creneauDebut !== undefined) {
      if (data.creneauDebut) {
        const { hours: h, minutes: m } = parseTime(data.creneauDebut);
        const d = new Date(point.tournee.date);
        d.setHours(h, m, 0, 0);
        updateData.creneauDebut = d;
      } else {
        updateData.creneauDebut = null;
      }
    }

    if (data.creneauFin !== undefined) {
      if (data.creneauFin) {
        const { hours: h, minutes: m } = parseTime(data.creneauFin);
        const d = new Date(point.tournee.date);
        d.setHours(h, m, 0, 0);
        updateData.creneauFin = d;
      } else {
        updateData.creneauFin = null;
      }
    }

    // Mettre à jour le point
    await prisma.point.update({
      where: { id: pointId },
      data: updateData,
    });

    // Mettre à jour les produits si fournis
    if (data.produits) {
      await prisma.pointProduit.deleteMany({ where: { pointId } });
      await prisma.pointProduit.createMany({
        data: data.produits.map((p) => ({
          pointId,
          produitId: p.produitId,
          quantite: p.quantite,
        })),
      });
    }

    // Mettre à jour les options si fournies
    if (data.options) {
      await prisma.pointOption.deleteMany({ where: { pointId } });
      if (data.options.length > 0) {
        await prisma.pointOption.createMany({
          data: data.options.map((o) => ({
            pointId,
            optionId: o.optionId,
          })),
        });
      }
    }

    // Recalculer la durée si produits/options changés
    if (data.produits || data.options || data.type) {
      const dureePrevue = await optimizationService.calculatePointDuration(pointId);
      await prisma.point.update({
        where: { id: pointId },
        data: { dureePrevue },
      });
    }

    // Mettre à jour les stats de la tournée
    await optimizationService.updateTourneeStats(id);

    const updated = await prisma.point.findUnique({
      where: { id: pointId },
      include: {
        client: true,
        produits: { include: { produit: true } },
        options: { include: { option: true } },
      },
    });

    // Fire-and-forget push notification (only if admin is editing)
    if (req.user?.roles.includes('admin')) {
      notificationService.notifyTourneeUpdated(
        point.tournee.chauffeurId,
        point.tournee.date.toISOString(),
        'modification d\'un point'
      ).catch(console.error);
    }

    apiResponse.success(res, updated, 'Point modifié');
  },

  /**
   * DELETE /api/tournees/:id/points/:pointId
   * Supprimer un point
   */
  async deletePoint(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const pointId = req.params.pointId as string;

    const point = await prisma.point.findFirst({
      where: { id: pointId, tourneeId: id },
      include: { tournee: true },
    });

    if (!point) {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }

    if (point.tournee.statut !== 'planifiee' && point.tournee.statut !== 'brouillon') {
      apiResponse.badRequest(res, 'Cette tournée ne peut plus être modifiée');
      return;
    }

    // Supprimer le point (cascade supprimera produits, options, photos)
    await prisma.point.delete({ where: { id: pointId } });

    // Réordonner les points restants
    const remainingPoints = await prisma.point.findMany({
      where: { tourneeId: id },
      orderBy: { ordre: 'asc' },
    });

    await prisma.$transaction(
      remainingPoints.map((p, index) =>
        prisma.point.update({
          where: { id: p.id },
          data: { ordre: index },
        })
      )
    );

    // Mettre à jour les stats (calcule les ETAs avec OSRM)
    await optimizationService.updateTourneeStats(id);

    // Fire-and-forget push notification
    notificationService.notifyPointRemoved(
      point.tournee.chauffeurId,
      point.tournee.date.toISOString()
    ).catch(console.error);

    // Retourner la tournée complète avec tous les points et leurs ETAs
    const updatedTournee = await getFullTournee(id);
    apiResponse.success(res, updatedTournee, 'Point supprimé');
  },

  /**
   * PUT /api/tournees/:id/points/reorder
   * Réordonner les points
   */
  async reorderPoints(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const body = req.body as ReorderPointsInput | { pointIds: string[] };

    const tournee = await prisma.tournee.findUnique({
      where: { id },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    if (tournee.statut !== 'planifiee' && tournee.statut !== 'brouillon') {
      apiResponse.badRequest(res, 'Cette tournée ne peut plus être modifiée');
      return;
    }

    // Support both formats: { points: [{id, ordre}] } or { pointIds: [] }
    let pointsToUpdate: Array<{ id: string; ordre: number }>;

    if ('pointIds' in body && Array.isArray(body.pointIds)) {
      // Simple format from frontend
      pointsToUpdate = body.pointIds.map((pointId, index) => ({
        id: pointId,
        ordre: index,
      }));
    } else if ('points' in body) {
      // Original format
      pointsToUpdate = body.points;
    } else {
      apiResponse.badRequest(res, 'Format invalide');
      return;
    }

    // Mettre à jour l'ordre de chaque point
    await prisma.$transaction(
      pointsToUpdate.map((p) =>
        prisma.point.update({
          where: { id: p.id },
          data: { ordre: p.ordre },
        })
      )
    );

    // Mettre à jour les stats (calcule les ETAs avec OSRM)
    await optimizationService.updateTourneeStats(id);

    // Fire-and-forget push notification
    notificationService.notifyPointsReordered(
      tournee.chauffeurId,
      tournee.date.toISOString()
    ).catch(console.error);

    // Retourner la tournée complète avec tous les points et leurs ETAs
    const updatedTournee = await getFullTournee(id);
    apiResponse.success(res, updatedTournee, 'Ordre mis à jour');
  },

  /**
   * PUT /api/tournees/:id/points/:pointId/move
   * Déplacer un point vers une autre tournée
   */
  async movePoint(req: Request, res: Response): Promise<void> {
    const sourceTourneeId = req.params.id as string;
    const pointId = req.params.pointId as string;
    const { targetTourneeId, ordre } = req.body as MovePointInput;

    // Vérifier que le point existe et appartient à la tournée source
    const point = await prisma.point.findFirst({
      where: { id: pointId, tourneeId: sourceTourneeId },
      include: {
        tournee: true,
        produits: true,
        options: true,
      },
    });

    if (!point) {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }

    if (!['brouillon', 'planifiee'].includes(point.tournee.statut)) {
      apiResponse.badRequest(res, 'La tournée source ne peut plus être modifiée');
      return;
    }

    // Vérifier que la tournée cible existe et est modifiable
    const targetTournee = await prisma.tournee.findUnique({
      where: { id: targetTourneeId },
      include: {
        _count: { select: { points: true } },
      },
    });

    if (!targetTournee) {
      apiResponse.notFound(res, 'Tournée cible non trouvée');
      return;
    }

    if (targetTournee.statut !== 'planifiee' && targetTournee.statut !== 'brouillon') {
      apiResponse.badRequest(res, 'La tournée cible ne peut plus être modifiée');
      return;
    }

    // Vérifier que les deux tournées sont à la même date
    const sourceDate = point.tournee.date.toISOString().split('T')[0];
    const targetDate = targetTournee.date.toISOString().split('T')[0];

    if (sourceDate !== targetDate) {
      apiResponse.badRequest(res, 'Les deux tournées doivent être à la même date');
      return;
    }

    // Calculer le nouvel ordre
    const newOrdre = ordre !== undefined ? ordre : targetTournee._count.points;

    await prisma.$transaction(async (tx) => {
      // 1. Mettre à jour les ordres dans la tournée cible pour faire de la place
      await tx.point.updateMany({
        where: {
          tourneeId: targetTourneeId,
          ordre: { gte: newOrdre },
        },
        data: {
          ordre: { increment: 1 },
        },
      });

      // 2. Déplacer le point vers la tournée cible
      await tx.point.update({
        where: { id: pointId },
        data: {
          tourneeId: targetTourneeId,
          ordre: newOrdre,
          // Remettre le statut à "à faire" si nécessaire
          statut: 'a_faire',
          heureArriveeEstimee: null, // Sera recalculé
        },
      });

      // 3. Réordonner les points restants dans la tournée source
      const remainingPoints = await tx.point.findMany({
        where: { tourneeId: sourceTourneeId },
        orderBy: { ordre: 'asc' },
      });

      for (let i = 0; i < remainingPoints.length; i++) {
        const point = remainingPoints[i];
        if (point) {
          await tx.point.update({
            where: { id: point.id },
            data: { ordre: i },
          });
        }
      }
    });

    // Mettre à jour les stats des deux tournées (calcule les ETAs avec OSRM)
    await Promise.all([
      optimizationService.updateTourneeStats(sourceTourneeId),
      optimizationService.updateTourneeStats(targetTourneeId),
    ]);

    // Retourner les deux tournées complètes avec tous les points et leurs ETAs
    const [sourceTournee, updatedTargetTournee] = await Promise.all([
      getFullTournee(sourceTourneeId),
      getFullTournee(targetTourneeId),
    ]);

    // Fire-and-forget push notifications for both chauffeurs
    {
      const srcDate = point.tournee.date.toISOString();
      const tgtDate = targetTournee.date.toISOString();
      const cName = (await prisma.client.findUnique({ where: { id: point.clientId }, select: { nom: true } }))?.nom || 'inconnu';

      if (point.tournee.chauffeurId !== targetTournee.chauffeurId) {
        notificationService.notifyPointMovedOut(point.tournee.chauffeurId, srcDate).catch(console.error);
        notificationService.notifyPointMovedIn(targetTournee.chauffeurId, tgtDate, cName).catch(console.error);
      } else {
        notificationService.notifyTourneeUpdated(point.tournee.chauffeurId, srcDate, 'déplacement d\'un point entre tournées').catch(console.error);
      }
    }

    apiResponse.success(res, {
      sourceTournee,
      targetTournee: updatedTargetTournee
    }, 'Point déplacé vers la nouvelle tournée');
  },

  /**
   * POST /api/tournees/import/preview
   * Prévisualiser l'import d'un fichier Excel (sans tournée - pour dispatch)
   */
  async importPreviewGeneral(req: Request, res: Response): Promise<void> {
    const { importService } = await import('../services/import.service.js');

    if (!req.file) {
      apiResponse.badRequest(res, 'Aucun fichier fourni');
      return;
    }

    try {
      const parsedPoints = await importService.parseExcel(req.file.buffer);
      apiResponse.success(res, { points: parsedPoints });
    } catch (error) {
      apiResponse.badRequest(res, `Erreur de lecture du fichier: ${(error as Error).message}`);
    }
  },

  /**
   * POST /api/tournees/:id/import/preview
   * Prévisualiser l'import d'un fichier Excel
   */
  async importPreview(req: Request, res: Response): Promise<void> {
    const { importService } = await import('../services/import.service.js');

    if (!req.file) {
      apiResponse.badRequest(res, 'Aucun fichier fourni');
      return;
    }

    try {
      const parsedPoints = await importService.parseExcel(req.file.buffer);
      apiResponse.success(res, { points: parsedPoints });
    } catch (error) {
      apiResponse.badRequest(res, `Erreur de lecture du fichier: ${(error as Error).message}`);
    }
  },

  /**
   * POST /api/tournees/:id/import
   * Importer les points depuis un fichier Excel
   */
  async importPoints(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const { importService } = await import('../services/import.service.js');

    // Vérifier que la tournée existe et est modifiable
    const tournee = await prisma.tournee.findUnique({
      where: { id },
    });

    if (!tournee) {
      apiResponse.notFound(res, 'Tournée non trouvée');
      return;
    }

    if (tournee.statut !== 'planifiee' && tournee.statut !== 'brouillon') {
      apiResponse.badRequest(res, 'Cette tournée ne peut plus être modifiée');
      return;
    }

    if (!req.file) {
      apiResponse.badRequest(res, 'Aucun fichier fourni');
      return;
    }

    try {
      // Parser le fichier
      const parsedPoints = await importService.parseExcel(req.file.buffer);

      if (parsedPoints.length === 0) {
        apiResponse.badRequest(res, 'Le fichier est vide ou ne contient aucune donnée valide');
        return;
      }

      // Importer les points
      const result = await importService.importPoints(id, parsedPoints);

      // Recalculer les stats de la tournée
      await optimizationService.updateTourneeStats(id);

      if (result.errors.length > 0) {
        apiResponse.success(res, result, `Import partiel: ${result.imported}/${result.totalRows} points importés`);
      } else {
        apiResponse.success(res, result, `${result.imported} points importés avec succès`);
      }
    } catch (error) {
      apiResponse.badRequest(res, `Erreur d'import: ${(error as Error).message}`);
    }
  },

  /**
   * POST /api/tournees/:id/points/:pointId/photos
   * Ajouter des photos à un point (upload vers Cloudinary)
   */
  async addPhotos(req: Request, res: Response): Promise<void> {
    const tourneeId = req.params.id as string;
    const pointId = req.params.pointId as string;

    // Vérifier que le point existe et appartient à la tournée
    const point = await prisma.point.findFirst({
      where: { id: pointId, tourneeId },
      include: { tournee: true },
    });

    if (!point) {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }

    if (point.tournee.statut !== 'en_cours') {
      apiResponse.badRequest(res, 'La tournée doit être en cours pour ajouter des photos');
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      apiResponse.badRequest(res, 'Aucun fichier fourni');
      return;
    }

    // Upload vers Cloudinary et créer les entrées en base
    const { uploadToCloudinary } = await import('../config/cloudinary.js');

    const photos = [];
    for (const file of files) {
      try {
        // Upload vers Cloudinary
        const { url, publicId } = await uploadToCloudinary(
          file.buffer,
          `optitourbooth/points/${pointId}`
        );

        // Créer l'entrée en base avec l'URL Cloudinary
        const photo = await prisma.photo.create({
          data: {
            pointId,
            filename: publicId, // Stocker le publicId pour pouvoir supprimer plus tard
            path: url, // L'URL Cloudinary
            mimetype: file.mimetype,
            size: file.size,
            type: 'preuve',
            takenAt: new Date(),
          },
        });
        photos.push(photo);
      } catch (uploadError) {
        console.error('Erreur upload Cloudinary:', uploadError);
        // Continuer avec les autres fichiers
      }
    }

    if (photos.length === 0) {
      apiResponse.badRequest(res, 'Erreur lors de l\'upload des photos');
      return;
    }

    apiResponse.success(res, photos, `${photos.length} photo(s) ajoutée(s)`);
  },

  /**
   * POST /api/tournees/:id/points/:pointId/incidents
   * Créer un incident pour un point
   */
  async createIncident(req: Request, res: Response): Promise<void> {
    const tourneeId = req.params.id as string;
    const pointId = req.params.pointId as string;
    const data = req.body as CreateIncidentInput;

    // Vérifier que le point existe et appartient à la tournée
    const point = await prisma.point.findFirst({
      where: { id: pointId, tourneeId },
      include: { tournee: true },
    });

    if (!point) {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }

    if (point.tournee.statut !== 'en_cours') {
      apiResponse.badRequest(res, 'La tournée doit être en cours pour signaler un incident');
      return;
    }

    // Créer l'incident
    const incident = await prisma.incident.create({
      data: {
        pointId,
        type: data.type,
        description: data.description,
        photosUrls: data.photosUrls || [],
        statut: 'ouvert',
        dateDeclaration: new Date(),
      },
    });

    // Mettre à jour le statut du point
    await prisma.point.update({
      where: { id: pointId },
      data: {
        statut: 'incident',
        heureDepartReelle: new Date(),
      },
    });

    apiResponse.success(res, incident, 'Incident créé');
  },

  /**
   * GET /api/tournees/optimization-status
   * Vérifier le statut du service d'optimisation (VROOM ou OSRM)
   */
  async getOptimizationStatus(req: Request, res: Response): Promise<void> {
    const vroomEnabled = config.vroom?.enabled || !!config.openRouteService?.apiKey;

    if (vroomEnabled) {
      const healthCheck = await vroomService.healthCheck();
      apiResponse.success(res, {
        engine: healthCheck.available ? healthCheck.service : 'OSRM (fallback)',
        vroomAvailable: healthCheck.available,
        vroomService: healthCheck.service,
        features: healthCheck.available
          ? ['time_windows', 'service_times', 'multi_vehicle', 'priorities']
          : ['distance_optimization'],
        message: healthCheck.available
          ? 'VROOM disponible - optimisation avec créneaux horaires'
          : 'VROOM indisponible - fallback sur OSRM (distance uniquement)',
      });
    } else {
      apiResponse.success(res, {
        engine: 'OSRM',
        vroomAvailable: false,
        vroomService: 'Non configuré',
        features: ['distance_optimization'],
        message: 'OSRM uniquement - configurez VROOM_ENABLED=true ou ORS_API_KEY pour les créneaux horaires',
      });
    }
  },

  /**
   * POST /api/tournees/auto-dispatch
   * Dispatcher automatiquement les points en attente vers les tournées
   */
  async autoDispatch(req: Request, res: Response): Promise<void> {
    const { date, pendingPoints } = req.body as {
      date: string;
      pendingPoints: Array<{
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
      }>;
    };

    if (!date || !pendingPoints || !Array.isArray(pendingPoints)) {
      apiResponse.badRequest(res, 'Date et points requis');
      return;
    }

    if (pendingPoints.length === 0) {
      apiResponse.badRequest(res, 'Aucun point à dispatcher');
      return;
    }

    const result = await autoDispatchService.dispatchPendingPoints(date, pendingPoints);

    // Récupérer les tournées mises à jour
    const updatedTourneeIds = [...new Set(result.dispatched.map((d) => d.assignedTourneeId))];
    const updatedTournees = await prisma.tournee.findMany({
      where: { id: { in: updatedTourneeIds } },
      include: {
        chauffeur: { select: { id: true, nom: true, prenom: true, couleur: true } },
        vehicule: { select: { id: true, nom: true, marque: true, modele: true, immatriculation: true, consommationL100km: true } },
        points: {
          orderBy: { ordre: 'asc' },
          include: {
            client: true,
            produits: { include: { produit: true } },
          },
        },
      },
    });

    // Fire-and-forget push notifications for each affected chauffeur
    const notifiedChauffeurs = new Set<string>();
    for (const t of updatedTournees) {
      if (!notifiedChauffeurs.has(t.chauffeurId)) {
        notifiedChauffeurs.add(t.chauffeurId);
        notificationService.notifyTourneeUpdated(
          t.chauffeurId,
          date,
          `dispatch automatique de ${result.totalDispatched} point(s)`
        ).catch(console.error);
      }
    }

    apiResponse.success(res, {
      ...result,
      updatedTournees,
    }, `${result.totalDispatched} point(s) dispatchés`);
  },
};

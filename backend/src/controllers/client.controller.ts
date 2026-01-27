import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { geocodingService } from '../services/geocoding.service.js';
import { apiResponse, parsePagination } from '../utils/index.js';
import {
  CreateClientInput,
  UpdateClientInput,
  ClientQueryInput,
} from '../validators/client.validator.js';

export const clientController = {
  /**
   * GET /api/clients
   * Liste des clients avec pagination et filtres
   */
  async list(req: Request, res: Response): Promise<void> {
    const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });
    const { actif, ville, codePostal, search } = req.query as {
      actif?: string;
      ville?: string;
      codePostal?: string;
      search?: string;
    };

    // Construire les filtres
    const where: {
      actif?: boolean;
      ville?: { contains: string; mode: 'insensitive' };
      codePostal?: string;
      OR?: Array<{ nom?: { contains: string; mode: 'insensitive' }; adresse?: { contains: string; mode: 'insensitive' }; email?: { contains: string; mode: 'insensitive' } }>;
    } = {};

    if (actif !== undefined) {
      where.actif = actif === 'true';
    }

    if (ville) {
      where.ville = { contains: ville, mode: 'insensitive' };
    }

    if (codePostal) {
      where.codePostal = codePostal;
    }

    if (search) {
      where.OR = [
        { nom: { contains: search, mode: 'insensitive' } },
        { adresse: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Exécuter la requête
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { nom: 'asc' },
        skip,
        take: limit,
      }),
      prisma.client.count({ where }),
    ]);

    apiResponse.paginated(res, clients, { page, limit, total });
  },

  /**
   * GET /api/clients/:id
   * Détails d'un client
   */
  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            points: true,
          },
        },
      },
    });

    if (!client) {
      apiResponse.notFound(res, 'Client non trouvé');
      return;
    }

    apiResponse.success(res, client);
  },

  /**
   * POST /api/clients
   * Créer un client
   */
  async create(req: Request, res: Response): Promise<void> {
    const clientData = req.body as CreateClientInput;

    // Si pas de coordonnées fournies, géocoder l'adresse
    if (!clientData.latitude || !clientData.longitude) {
      const geocoded = await geocodingService.geocodeAddress(
        clientData.adresse,
        clientData.codePostal,
        clientData.ville,
        clientData.pays
      );

      if (geocoded) {
        clientData.latitude = geocoded.latitude;
        clientData.longitude = geocoded.longitude;
      }
    }

    const client = await prisma.client.create({
      data: clientData,
    });

    apiResponse.created(res, client, 'Client créé');
  },

  /**
   * PUT /api/clients/:id
   * Modifier un client
   */
  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const updateData = req.body as UpdateClientInput;

    // Vérifier que le client existe
    const existingClient = await prisma.client.findUnique({
      where: { id },
    });

    if (!existingClient) {
      apiResponse.notFound(res, 'Client non trouvé');
      return;
    }

    // Si l'adresse change et pas de nouvelles coordonnées, re-géocoder
    const addressChanged =
      updateData.adresse !== undefined ||
      updateData.codePostal !== undefined ||
      updateData.ville !== undefined;

    if (addressChanged && !updateData.latitude && !updateData.longitude) {
      const newAdresse = updateData.adresse || existingClient.adresse;
      const newCodePostal = updateData.codePostal || existingClient.codePostal;
      const newVille = updateData.ville || existingClient.ville;
      const newPays = updateData.pays || existingClient.pays;

      const geocoded = await geocodingService.geocodeAddress(
        newAdresse,
        newCodePostal,
        newVille,
        newPays
      );

      if (geocoded) {
        updateData.latitude = geocoded.latitude;
        updateData.longitude = geocoded.longitude;
      }
    }

    const client = await prisma.client.update({
      where: { id },
      data: updateData,
    });

    apiResponse.success(res, client, 'Client modifié');
  },

  /**
   * DELETE /api/clients/:id
   * Supprimer un client (soft delete)
   */
  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    // Vérifier que le client existe
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            points: {
              where: {
                statut: { in: ['a_faire', 'en_cours'] },
              },
            },
          },
        },
      },
    });

    if (!client) {
      apiResponse.notFound(res, 'Client non trouvé');
      return;
    }

    // Empêcher la suppression si des points actifs
    if (client._count.points > 0) {
      apiResponse.badRequest(
        res,
        'Ce client a des livraisons en cours. Veuillez les terminer avant de le supprimer.'
      );
      return;
    }

    // Soft delete
    await prisma.client.update({
      where: { id },
      data: { actif: false },
    });

    apiResponse.success(res, null, 'Client désactivé');
  },

  /**
   * POST /api/clients/:id/geocode
   * Re-géocoder l'adresse d'un client
   */
  async geocode(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const client = await prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      apiResponse.notFound(res, 'Client non trouvé');
      return;
    }

    const geocoded = await geocodingService.geocodeAddress(
      client.adresse,
      client.codePostal,
      client.ville,
      client.pays
    );

    if (!geocoded) {
      apiResponse.badRequest(res, 'Impossible de géocoder cette adresse');
      return;
    }

    const updated = await prisma.client.update({
      where: { id },
      data: {
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
      },
    });

    apiResponse.success(res, updated, 'Adresse géocodée');
  },

  /**
   * GET /api/clients/search
   * Recherche rapide de clients (pour autocomplete)
   */
  async search(req: Request, res: Response): Promise<void> {
    const { q } = req.query as { q?: string };

    if (!q || q.length < 2) {
      apiResponse.success(res, []);
      return;
    }

    const clients = await prisma.client.findMany({
      where: {
        actif: true,
        OR: [
          { nom: { contains: q, mode: 'insensitive' } },
          { ville: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        nom: true,
        adresse: true,
        codePostal: true,
        ville: true,
        latitude: true,
        longitude: true,
      },
      take: 10,
      orderBy: { nom: 'asc' },
    });

    apiResponse.success(res, clients);
  },

  /**
   * GET /api/clients/villes
   * Liste des villes distinctes (pour filtres)
   */
  async listVilles(_req: Request, res: Response): Promise<void> {
    const villes = await prisma.client.groupBy({
      by: ['ville'],
      where: { actif: true },
      orderBy: { ville: 'asc' },
    });

    apiResponse.success(res, villes.map((v) => v.ville));
  },
};

import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { geocodingService } from '../services/geocoding.service.js';
import { apiResponse, parsePagination } from '../utils/index.js';
import {
  CreateClientInput,
  UpdateClientInput,
  ClientQueryInput,
} from '../validators/client.validator.js';
import { parsePhoneNumbers, formatPhoneNumbers } from '../utils/phoneParser.js';

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

    // Construire les filtres (utilisés uniquement quand pas de recherche texte)
    const where: {
      actif?: boolean;
      ville?: { contains: string; mode: 'insensitive' };
      codePostal?: string;
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

    // Note: quand search est présent, on utilise un raw query avec unaccent() plus bas

    // Exécuter la requête
    let clients: unknown[];
    let total: number;

    if (search) {
      // Utiliser unaccent pour une recherche insensible aux accents via PostgreSQL
      const normalizedSearch = `%${search.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}%`;

      // Construire les conditions additionnelles
      const conditions: string[] = ['1=1'];
      const params: (string | boolean | number)[] = [];
      let paramIndex = 1;

      if (actif !== undefined) {
        conditions.push(`"actif" = $${paramIndex}`);
        params.push(actif === 'true');
        paramIndex++;
      }
      if (ville) {
        conditions.push(`LOWER("ville") LIKE LOWER($${paramIndex})`);
        params.push(`%${ville}%`);
        paramIndex++;
      }
      if (codePostal) {
        conditions.push(`"codePostal" = $${paramIndex}`);
        params.push(codePostal);
        paramIndex++;
      }

      const searchParam = normalizedSearch;
      const searchCondition = `(
        unaccent(LOWER("nom")) LIKE unaccent(LOWER($${paramIndex}))
        OR unaccent(LOWER(COALESCE("societe", ''))) LIKE unaccent(LOWER($${paramIndex}))
        OR unaccent(LOWER(COALESCE("adresse", ''))) LIKE unaccent(LOWER($${paramIndex}))
        OR unaccent(LOWER(COALESCE("email", ''))) LIKE unaccent(LOWER($${paramIndex}))
      )`;
      conditions.push(searchCondition);
      params.push(searchParam);
      paramIndex++;

      const whereClause = conditions.join(' AND ');

      const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM "clients" WHERE ${whereClause}`,
        ...params
      );
      total = Number(countResult[0].count);

      clients = await prisma.$queryRawUnsafe<unknown[]>(
        `SELECT * FROM "clients" WHERE ${whereClause} ORDER BY "nom" ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        ...params, limit, skip
      );
    } else {
      [clients, total] = await Promise.all([
        prisma.client.findMany({
          where,
          orderBy: { nom: 'asc' },
          skip,
          take: limit,
        }),
        prisma.client.count({ where }),
      ]);
    }

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
        clientData.codePostal || undefined,
        clientData.ville || undefined,
        clientData.pays
      );

      if (geocoded) {
        clientData.latitude = geocoded.latitude;
        clientData.longitude = geocoded.longitude;
      }
    }

    // Normaliser les numéros de téléphone (détection automatique de plusieurs numéros)
    if (clientData.contactTelephone) {
      const phones = parsePhoneNumbers(clientData.contactTelephone);
      clientData.contactTelephone = formatPhoneNumbers(phones);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = await prisma.client.create({
      data: clientData as any,
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
      const newCodePostal = updateData.codePostal ?? existingClient.codePostal ?? undefined;
      const newVille = updateData.ville ?? existingClient.ville ?? undefined;
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

    // Normaliser les numéros de téléphone (détection automatique de plusieurs numéros)
    if (updateData.contactTelephone !== undefined && updateData.contactTelephone !== null) {
      const phones = parsePhoneNumbers(updateData.contactTelephone);
      updateData.contactTelephone = formatPhoneNumbers(phones);
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
      client.codePostal || undefined,
      client.ville || undefined,
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

    // Recherche insensible aux accents via unaccent()
    const searchTerm = `%${q}%`;
    const clients = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT "id", "nom", "societe", "adresse", "codePostal", "ville", "latitude", "longitude"
       FROM "clients"
       WHERE "actif" = true
         AND (
           unaccent(LOWER("nom")) LIKE unaccent(LOWER($1))
           OR unaccent(LOWER(COALESCE("societe", ''))) LIKE unaccent(LOWER($1))
           OR unaccent(LOWER(COALESCE("ville", ''))) LIKE unaccent(LOWER($1))
         )
       ORDER BY "nom" ASC
       LIMIT 10`,
      searchTerm
    );

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

    // Filtrer les villes nulles ou vides
    apiResponse.success(res, villes.map((v) => v.ville).filter((v): v is string => Boolean(v)));
  },
};

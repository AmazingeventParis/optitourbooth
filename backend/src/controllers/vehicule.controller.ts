import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/apiResponse.js';

export const vehiculeController = {
  /**
   * Liste des véhicules
   */
  async list(req: Request, res: Response): Promise<void> {
    const { page = '1', limit = '50', actif, search } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {};

    if (actif !== undefined) {
      where.actif = actif === 'true';
    }

    if (search) {
      where.OR = [
        { nom: { contains: search as string, mode: 'insensitive' } },
        { marque: { contains: search as string, mode: 'insensitive' } },
        { modele: { contains: search as string, mode: 'insensitive' } },
        { immatriculation: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [vehicules, total] = await Promise.all([
      prisma.vehicule.findMany({
        where,
        orderBy: { nom: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.vehicule.count({ where }),
    ]);

    apiResponse.paginated(res, vehicules, { page: pageNum, limit: limitNum, total });
  },

  /**
   * Liste des véhicules actifs (pour les selects)
   */
  async listActifs(_req: Request, res: Response): Promise<void> {
    const vehicules = await prisma.vehicule.findMany({
      where: { actif: true },
      orderBy: { nom: 'asc' },
      select: {
        id: true,
        nom: true,
        marque: true,
        modele: true,
        immatriculation: true,
        consommationL100km: true,
      },
    });

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    apiResponse.success(res, vehicules);
  },

  /**
   * Détail d'un véhicule
   */
  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const vehicule = await prisma.vehicule.findUnique({
      where: { id },
      include: {
        _count: {
          select: { tournees: true },
        },
      },
    });

    if (!vehicule) {
      apiResponse.notFound(res, 'Véhicule non trouvé');
      return;
    }

    apiResponse.success(res, vehicule);
  },

  /**
   * Créer un véhicule
   */
  async create(req: Request, res: Response): Promise<void> {
    const { nom, marque, modele, immatriculation, consommationL100km, capaciteKg, capaciteM3, notes } = req.body;

    // Vérifier l'unicité de l'immatriculation
    const existing = await prisma.vehicule.findUnique({
      where: { immatriculation },
    });

    if (existing) {
      apiResponse.badRequest(res, 'Un véhicule avec cette immatriculation existe déjà');
      return;
    }

    const vehicule = await prisma.vehicule.create({
      data: {
        nom,
        marque,
        modele,
        immatriculation,
        consommationL100km,
        capaciteKg,
        capaciteM3,
        notes,
      },
    });

    apiResponse.created(res, vehicule);
  },

  /**
   * Modifier un véhicule
   */
  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { nom, marque, modele, immatriculation, consommationL100km, capaciteKg, capaciteM3, notes, actif } = req.body;

    // Vérifier si le véhicule existe
    const existing = await prisma.vehicule.findUnique({
      where: { id },
    });

    if (!existing) {
      apiResponse.notFound(res, 'Véhicule non trouvé');
      return;
    }

    // Vérifier l'unicité de l'immatriculation si modifiée
    if (immatriculation && immatriculation !== existing.immatriculation) {
      const duplicate = await prisma.vehicule.findUnique({
        where: { immatriculation },
      });

      if (duplicate) {
        apiResponse.badRequest(res, 'Un véhicule avec cette immatriculation existe déjà');
        return;
      }
    }

    const vehicule = await prisma.vehicule.update({
      where: { id },
      data: {
        nom,
        marque,
        modele,
        immatriculation,
        consommationL100km,
        capaciteKg,
        capaciteM3,
        notes,
        actif,
      },
    });

    apiResponse.success(res, vehicule);
  },

  /**
   * Supprimer un véhicule
   */
  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    // Vérifier si le véhicule existe
    const existing = await prisma.vehicule.findUnique({
      where: { id },
      include: {
        _count: {
          select: { tournees: true },
        },
      },
    });

    if (!existing) {
      apiResponse.notFound(res, 'Véhicule non trouvé');
      return;
    }

    // Si le véhicule a des tournées, désactiver au lieu de supprimer
    if (existing._count.tournees > 0) {
      await prisma.vehicule.update({
        where: { id },
        data: { actif: false },
      });
      apiResponse.success(res, { message: 'Véhicule désactivé (tournées associées)' });
      return;
    }

    await prisma.vehicule.delete({
      where: { id },
    });

    apiResponse.success(res, { message: 'Véhicule supprimé' });
  },
};

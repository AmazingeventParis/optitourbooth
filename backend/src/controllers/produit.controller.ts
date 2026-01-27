import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse, parsePagination } from '../utils/index.js';
import {
  CreateProduitInput,
  UpdateProduitInput,
  ProduitQueryInput,
  CreateOptionInput,
  UpdateOptionInput,
} from '../validators/produit.validator.js';

export const produitController = {
  /**
   * GET /api/produits
   * Liste des produits avec pagination et filtres
   */
  async list(req: Request, res: Response): Promise<void> {
    const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });
    const { actif, search } = req.query as {
      actif?: string;
      search?: string;
    };

    // Construire les filtres
    const where: {
      actif?: boolean;
      nom?: { contains: string; mode: 'insensitive' };
    } = {};

    if (actif !== undefined) {
      where.actif = actif === 'true';
    }

    if (search) {
      where.nom = { contains: search, mode: 'insensitive' };
    }

    // Exécuter la requête
    const [produits, total] = await Promise.all([
      prisma.produit.findMany({
        where,
        include: {
          options: {
            where: { actif: true },
            orderBy: { nom: 'asc' },
          },
          _count: {
            select: { pointProduits: true },
          },
        },
        orderBy: { nom: 'asc' },
        skip,
        take: limit,
      }),
      prisma.produit.count({ where }),
    ]);

    apiResponse.paginated(res, produits, { page, limit, total });
  },

  /**
   * GET /api/produits/:id
   * Détails d'un produit
   */
  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const produit = await prisma.produit.findUnique({
      where: { id },
      include: {
        options: {
          orderBy: { nom: 'asc' },
        },
        _count: {
          select: { pointProduits: true },
        },
      },
    });

    if (!produit) {
      apiResponse.notFound(res, 'Produit non trouvé');
      return;
    }

    apiResponse.success(res, produit);
  },

  /**
   * POST /api/produits
   * Créer un produit
   */
  async create(req: Request, res: Response): Promise<void> {
    const produitData = req.body as CreateProduitInput;

    // Vérifier que le nom n'existe pas déjà
    const existingProduit = await prisma.produit.findUnique({
      where: { nom: produitData.nom },
    });

    if (existingProduit) {
      apiResponse.conflict(res, 'Ce nom de produit existe déjà');
      return;
    }

    const produit = await prisma.produit.create({
      data: produitData,
      include: {
        options: true,
      },
    });

    apiResponse.created(res, produit, 'Produit créé');
  },

  /**
   * PUT /api/produits/:id
   * Modifier un produit
   */
  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const updateData = req.body as UpdateProduitInput;

    // Vérifier que le produit existe
    const existingProduit = await prisma.produit.findUnique({
      where: { id },
    });

    if (!existingProduit) {
      apiResponse.notFound(res, 'Produit non trouvé');
      return;
    }

    // Si changement de nom, vérifier qu'il n'est pas déjà pris
    if (updateData.nom && updateData.nom !== existingProduit.nom) {
      const nomTaken = await prisma.produit.findUnique({
        where: { nom: updateData.nom },
      });

      if (nomTaken) {
        apiResponse.conflict(res, 'Ce nom de produit existe déjà');
        return;
      }
    }

    const produit = await prisma.produit.update({
      where: { id },
      data: updateData,
      include: {
        options: true,
      },
    });

    apiResponse.success(res, produit, 'Produit modifié');
  },

  /**
   * DELETE /api/produits/:id
   * Supprimer un produit définitivement
   */
  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    // Vérifier que le produit existe
    const produit = await prisma.produit.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            pointProduits: {
              where: {
                point: {
                  statut: { in: ['a_faire', 'en_cours'] },
                },
              },
            },
          },
        },
      },
    });

    if (!produit) {
      apiResponse.notFound(res, 'Produit non trouvé');
      return;
    }

    // Empêcher la suppression si utilisé dans des points actifs
    if (produit._count.pointProduits > 0) {
      apiResponse.badRequest(
        res,
        'Ce produit est utilisé dans des livraisons en cours.'
      );
      return;
    }

    // Supprimer d'abord les options associées
    await prisma.produitOption.deleteMany({
      where: { produitId: id },
    });

    // Supprimer le produit
    await prisma.produit.delete({
      where: { id },
    });

    apiResponse.success(res, null, 'Produit supprimé');
  },

  /**
   * GET /api/produits/actifs
   * Liste des produits actifs (pour les selects)
   */
  async listActifs(_req: Request, res: Response): Promise<void> {
    const produits = await prisma.produit.findMany({
      where: { actif: true },
      select: {
        id: true,
        nom: true,
        couleur: true,
        dureeInstallation: true,
        dureeDesinstallation: true,
        options: {
          where: { actif: true },
          select: {
            id: true,
            nom: true,
            dureeSupp: true,
          },
        },
      },
      orderBy: { nom: 'asc' },
    });

    apiResponse.success(res, produits);
  },

  // ========== OPTIONS ==========

  /**
   * POST /api/produits/:id/options
   * Ajouter une option à un produit
   */
  async createOption(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const optionData = req.body as CreateOptionInput;

    // Vérifier que le produit existe
    const produit = await prisma.produit.findUnique({
      where: { id },
    });

    if (!produit) {
      apiResponse.notFound(res, 'Produit non trouvé');
      return;
    }

    const option = await prisma.produitOption.create({
      data: {
        ...optionData,
        produitId: produit.id,
      },
    });

    apiResponse.created(res, option, 'Option ajoutée');
  },

  /**
   * PUT /api/produits/:id/options/:optionId
   * Modifier une option
   */
  async updateOption(req: Request, res: Response): Promise<void> {
    const { id, optionId } = req.params;
    const updateData = req.body as UpdateOptionInput;

    // Vérifier que l'option existe et appartient au produit
    const option = await prisma.produitOption.findFirst({
      where: { id: optionId, produitId: id },
    });

    if (!option) {
      apiResponse.notFound(res, 'Option non trouvée');
      return;
    }

    const updated = await prisma.produitOption.update({
      where: { id: optionId },
      data: updateData,
    });

    apiResponse.success(res, updated, 'Option modifiée');
  },

  /**
   * DELETE /api/produits/:id/options/:optionId
   * Supprimer une option (soft delete)
   */
  async deleteOption(req: Request, res: Response): Promise<void> {
    const { id, optionId } = req.params;

    // Vérifier que l'option existe et appartient au produit
    const option = await prisma.produitOption.findFirst({
      where: { id: optionId, produitId: id },
    });

    if (!option) {
      apiResponse.notFound(res, 'Option non trouvée');
      return;
    }

    // Soft delete
    await prisma.produitOption.update({
      where: { id: optionId },
      data: { actif: false },
    });

    apiResponse.success(res, null, 'Option désactivée');
  },
};

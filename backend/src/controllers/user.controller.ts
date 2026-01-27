import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { authService } from '../services/auth.service.js';
import { apiResponse, parsePagination } from '../utils/index.js';
import { UserRole } from '@prisma/client';

export const userController = {
  /**
   * GET /api/users
   * Liste des utilisateurs avec pagination et filtres
   */
  async list(req: Request, res: Response): Promise<void> {
    const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });
    const { role, actif, search } = req.query as {
      role?: UserRole;
      actif?: string;
      search?: string;
    };

    // Construire les filtres
    const where: {
      role?: UserRole;
      actif?: boolean;
      OR?: Array<{
        nom?: { contains: string; mode: 'insensitive' };
        prenom?: { contains: string; mode: 'insensitive' };
        email?: { contains: string; mode: 'insensitive' };
      }>;
    } = {};

    if (role) {
      where.role = role;
    }

    if (actif !== undefined) {
      where.actif = actif === 'true';
    }

    if (search) {
      where.OR = [
        { nom: { contains: search, mode: 'insensitive' } },
        { prenom: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Exécuter la requête
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          role: true,
          nom: true,
          prenom: true,
          telephone: true,
          couleur: true,
          actif: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    apiResponse.paginated(res, users, { page, limit, total });
  },

  /**
   * GET /api/users/:id
   * Détails d'un utilisateur
   */
  async getById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        nom: true,
        prenom: true,
        telephone: true,
        couleur: true,
        actif: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        _count: {
          select: {
            tournees: true,
          },
        },
      },
    });

    if (!user) {
      apiResponse.notFound(res, 'Utilisateur non trouvé');
      return;
    }

    apiResponse.success(res, user);
  },

  /**
   * POST /api/users
   * Créer un utilisateur
   */
  async create(req: Request, res: Response): Promise<void> {
    const { password, ...userData } = req.body as {
      password: string;
      email: string;
      role: UserRole;
      nom: string;
      prenom: string;
      telephone?: string;
      couleur?: string;
    };

    // Vérifier que l'email n'existe pas déjà
    const existingUser = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existingUser) {
      apiResponse.conflict(res, 'Cet email est déjà utilisé');
      return;
    }

    // Hasher le mot de passe
    const passwordHash = await authService.hashPassword(password);

    // Créer l'utilisateur
    const user = await prisma.user.create({
      data: {
        ...userData,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        role: true,
        nom: true,
        prenom: true,
        telephone: true,
        couleur: true,
        actif: true,
        createdAt: true,
      },
    });

    apiResponse.created(res, user, 'Utilisateur créé');
  },

  /**
   * PUT /api/users/:id
   * Modifier un utilisateur
   */
  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { password, ...updateData } = req.body as {
      password?: string;
      email?: string;
      role?: UserRole;
      nom?: string;
      prenom?: string;
      telephone?: string | null;
      couleur?: string | null;
      actif?: boolean;
    };

    // Vérifier que l'utilisateur existe
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      apiResponse.notFound(res, 'Utilisateur non trouvé');
      return;
    }

    // Si changement d'email, vérifier qu'il n'est pas déjà pris
    if (updateData.email && updateData.email !== existingUser.email) {
      const emailTaken = await prisma.user.findUnique({
        where: { email: updateData.email },
      });

      if (emailTaken) {
        apiResponse.conflict(res, 'Cet email est déjà utilisé');
        return;
      }
    }

    // Préparer les données de mise à jour
    const dataToUpdate: typeof updateData & { passwordHash?: string } = { ...updateData };

    // Si nouveau mot de passe, le hasher
    if (password) {
      dataToUpdate.passwordHash = await authService.hashPassword(password);
    }

    // Mettre à jour
    const user = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        role: true,
        nom: true,
        prenom: true,
        telephone: true,
        couleur: true,
        actif: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    apiResponse.success(res, user, 'Utilisateur modifié');
  },

  /**
   * DELETE /api/users/:id
   * Supprimer un utilisateur (soft delete = désactivation)
   */
  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      apiResponse.notFound(res, 'Utilisateur non trouvé');
      return;
    }

    // Empêcher la suppression de son propre compte
    if (req.user?.id === id) {
      apiResponse.badRequest(res, 'Vous ne pouvez pas supprimer votre propre compte');
      return;
    }

    // Soft delete : désactiver plutôt que supprimer
    await prisma.user.update({
      where: { id },
      data: { actif: false },
    });

    // Invalider tous ses tokens
    await authService.logoutAll(user.id);

    apiResponse.success(res, null, 'Utilisateur désactivé');
  },

  /**
   * GET /api/users/chauffeurs
   * Liste des chauffeurs actifs (pour les selects)
   */
  async listChauffeurs(_req: Request, res: Response): Promise<void> {
    const chauffeurs = await prisma.user.findMany({
      where: {
        role: 'chauffeur',
        actif: true,
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        telephone: true,
        couleur: true,
      },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });

    apiResponse.success(res, chauffeurs);
  },
};

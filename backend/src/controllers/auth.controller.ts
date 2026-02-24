import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { authService } from '../services/auth.service.js';
import { apiResponse } from '../utils/index.js';

export const authController = {
  /**
   * POST /api/auth/login
   * Connexion utilisateur
   */
  async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as { email: string; password: string };

    const { user, tokens } = await authService.login(email, password);

    apiResponse.success(res, {
      user,
      token: tokens.token,
      refreshToken: tokens.refreshToken,
    }, 'Connexion réussie');
  },

  /**
   * POST /api/auth/refresh
   * Rafraîchir le token d'accès
   */
  async refresh(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body as { refreshToken: string };

    const tokens = await authService.refreshTokens(refreshToken);

    apiResponse.success(res, tokens, 'Token rafraîchi');
  },

  /**
   * POST /api/auth/logout
   * Déconnexion (invalide le refresh token)
   */
  async logout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body as { refreshToken: string };

    await authService.logout(refreshToken);

    apiResponse.success(res, null, 'Déconnexion réussie');
  },

  /**
   * POST /api/auth/logout-all
   * Déconnexion de tous les appareils
   */
  async logoutAll(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      apiResponse.unauthorized(res);
      return;
    }

    await authService.logoutAll(req.user.id);

    apiResponse.success(res, null, 'Déconnexion de tous les appareils réussie');
  },

  /**
   * GET /api/auth/me
   * Obtenir les informations de l'utilisateur connecté
   */
  async me(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      apiResponse.unauthorized(res);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        roles: true,
        nom: true,
        prenom: true,
        telephone: true,
        avatarUrl: true,
        actif: true,
        tenantId: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      apiResponse.notFound(res, 'Utilisateur non trouvé');
      return;
    }

    apiResponse.success(res, user);
  },

  /**
   * PUT /api/auth/password
   * Changer le mot de passe
   */
  async changePassword(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      apiResponse.unauthorized(res);
      return;
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };

    // Récupérer l'utilisateur avec le hash
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      apiResponse.notFound(res, 'Utilisateur non trouvé');
      return;
    }

    // Vérifier le mot de passe actuel
    const isValid = await authService.verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      apiResponse.badRequest(res, 'Mot de passe actuel incorrect');
      return;
    }

    // Mettre à jour le mot de passe
    const newHash = await authService.hashPassword(newPassword);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: newHash },
    });

    // Invalider tous les refresh tokens (sécurité)
    await authService.logoutAll(req.user.id);

    apiResponse.success(res, null, 'Mot de passe modifié. Veuillez vous reconnecter.');
  },
};

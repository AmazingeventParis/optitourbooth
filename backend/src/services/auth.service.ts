import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { AppError } from '../middlewares/error.middleware.js';

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

interface AuthTokens {
  token: string;
  refreshToken: string;
}

interface UserWithoutPassword {
  id: string;
  email: string;
  role: string;
  nom: string;
  prenom: string;
  telephone: string | null;
  actif: boolean;
}

export const authService = {
  /**
   * Authentifier un utilisateur
   */
  async login(
    email: string,
    password: string
  ): Promise<{ user: UserWithoutPassword; tokens: AuthTokens }> {
    // Trouver l'utilisateur
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw new AppError('Email ou mot de passe incorrect', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.actif) {
      throw new AppError('Compte désactivé', 403, 'ACCOUNT_DISABLED');
    }

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError('Email ou mot de passe incorrect', 401, 'INVALID_CREDENTIALS');
    }

    // Mettre à jour la date de dernière connexion
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Générer les tokens
    const tokens = await this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Retourner l'utilisateur sans le mot de passe
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      tokens,
    };
  },

  /**
   * Rafraîchir les tokens
   */
  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    // Vérifier que le refresh token existe en base
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!storedToken) {
      throw new AppError('Refresh token invalide', 401, 'INVALID_REFRESH_TOKEN');
    }

    if (storedToken.expiresAt < new Date()) {
      // Supprimer le token expiré
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new AppError('Refresh token expiré', 401, 'REFRESH_TOKEN_EXPIRED');
    }

    // Vérifier le token JWT
    let decoded: TokenPayload;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as TokenPayload;
    } catch {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new AppError('Refresh token invalide', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Vérifier que l'utilisateur existe et est actif
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.actif) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new AppError('Utilisateur invalide', 401, 'INVALID_USER');
    }

    // Supprimer l'ancien refresh token
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    // Générer de nouveaux tokens
    return this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
  },

  /**
   * Déconnecter (invalider le refresh token)
   */
  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  },

  /**
   * Déconnecter de tous les appareils
   */
  async logoutAll(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });
  },

  /**
   * Générer les tokens d'authentification
   */
  async generateTokens(payload: TokenPayload): Promise<AuthTokens> {
    // Token d'accès (courte durée)
    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
    });

    // Refresh token (longue durée)
    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn as jwt.SignOptions['expiresIn'],
    });

    // Calculer la date d'expiration du refresh token
    const refreshExpiresIn = config.jwt.refreshExpiresIn;
    const expiresAt = new Date();
    if (refreshExpiresIn.endsWith('d')) {
      expiresAt.setDate(expiresAt.getDate() + parseInt(refreshExpiresIn));
    } else if (refreshExpiresIn.endsWith('h')) {
      expiresAt.setHours(expiresAt.getHours() + parseInt(refreshExpiresIn));
    }

    // Stocker le refresh token en base
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: payload.userId,
        expiresAt,
      },
    });

    return { token, refreshToken };
  },

  /**
   * Hasher un mot de passe
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  },

  /**
   * Vérifier un mot de passe
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  /**
   * Nettoyer les refresh tokens expirés (à appeler périodiquement)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  },
};

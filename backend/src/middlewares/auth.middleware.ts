import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';

// Étendre le type Request pour inclure l'utilisateur
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        roles: Array<'admin' | 'chauffeur' | 'utilisateur'>;
        nom: string;
        prenom: string;
      };
    }
  }
}

interface JwtPayload {
  userId: string;
  email: string;
  roles: Array<'admin' | 'chauffeur' | 'utilisateur'>;
}

// Middleware d'authentification
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Récupérer le token depuis le header Authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      apiResponse.unauthorized(res, 'Token manquant');
      return;
    }

    const token = authHeader.substring(7);

    // Vérifier le token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        apiResponse.unauthorized(res, 'Token expiré');
        return;
      }
      apiResponse.unauthorized(res, 'Token invalide');
      return;
    }

    // Vérifier que l'utilisateur existe et est actif
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        roles: true,
        nom: true,
        prenom: true,
        actif: true,
      },
    });

    if (!user) {
      apiResponse.unauthorized(res, 'Utilisateur non trouvé');
      return;
    }

    if (!user.actif) {
      apiResponse.forbidden(res, 'Compte désactivé');
      return;
    }

    // Attacher l'utilisateur à la requête
    req.user = {
      id: user.id,
      email: user.email,
      roles: user.roles,
      nom: user.nom,
      prenom: user.prenom,
    };

    next();
  } catch (error) {
    console.error('Erreur middleware auth:', error);
    apiResponse.serverError(res);
  }
}

// Middleware pour vérifier le rôle admin
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    apiResponse.unauthorized(res);
    return;
  }

  if (!req.user.roles.includes('admin')) {
    apiResponse.forbidden(res, 'Accès réservé aux administrateurs');
    return;
  }

  next();
}

// Middleware pour vérifier le rôle chauffeur
export function requireChauffeur(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    apiResponse.unauthorized(res);
    return;
  }

  if (!req.user.roles.includes('chauffeur')) {
    apiResponse.forbidden(res, 'Accès réservé aux chauffeurs');
    return;
  }

  next();
}

// Middleware pour vérifier qu'un utilisateur a au moins un des rôles spécifiés
export function requireRole(...allowedRoles: Array<'admin' | 'chauffeur' | 'utilisateur'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      apiResponse.unauthorized(res);
      return;
    }

    const hasRole = allowedRoles.some(role => req.user!.roles.includes(role));
    if (!hasRole) {
      apiResponse.forbidden(res, `Accès réservé aux: ${allowedRoles.join(', ')}`);
      return;
    }

    next();
  };
}

// Middleware optionnel - n'échoue pas si pas de token
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          roles: true,
          nom: true,
          prenom: true,
          actif: true,
        },
      });

      if (user && user.actif) {
        req.user = {
          id: user.id,
          email: user.email,
          roles: user.roles,
          nom: user.nom,
          prenom: user.prenom,
        };
      }
    } catch {
      // Token invalide, on continue sans user
    }

    next();
  } catch {
    next();
  }
}

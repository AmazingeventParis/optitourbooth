import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { config } from '../config/index.js';
import { apiResponse } from '../utils/index.js';

// Classe d'erreur personnalisée
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Erreurs prédéfinies
export const errors = {
  notFound: (resource = 'Ressource') =>
    new AppError(`${resource} non trouvé(e)`, 404, 'NOT_FOUND'),

  unauthorized: (message = 'Non authentifié') =>
    new AppError(message, 401, 'UNAUTHORIZED'),

  forbidden: (message = 'Accès interdit') =>
    new AppError(message, 403, 'FORBIDDEN'),

  badRequest: (message = 'Requête invalide') =>
    new AppError(message, 400, 'BAD_REQUEST'),

  conflict: (message = 'Conflit') =>
    new AppError(message, 409, 'CONFLICT'),

  tooManyRequests: (message = 'Trop de requêtes') =>
    new AppError(message, 429, 'TOO_MANY_REQUESTS'),
};

// Middleware de gestion des erreurs 404
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  apiResponse.notFound(res, `Route ${req.method} ${req.path} non trouvée`);
}

// Middleware de gestion des erreurs globales
export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log de l'erreur en développement
  if (config.isDev) {
    console.error('❌ Erreur:', error);
  }

  // Erreur personnalisée AppError
  if (error instanceof AppError) {
    apiResponse.error(res, error.code, error.message, error.statusCode);
    return;
  }

  // Erreurs Prisma
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    handlePrismaError(error, res);
    return;
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    apiResponse.badRequest(res, 'Données invalides pour la base de données');
    return;
  }

  // Erreur JWT
  if (error.name === 'JsonWebTokenError') {
    apiResponse.unauthorized(res, 'Token invalide');
    return;
  }

  if (error.name === 'TokenExpiredError') {
    apiResponse.unauthorized(res, 'Token expiré');
    return;
  }

  // Erreur de syntaxe JSON
  if (error instanceof SyntaxError && 'body' in error) {
    apiResponse.badRequest(res, 'JSON invalide dans le corps de la requête');
    return;
  }

  // Erreur générique - ne pas exposer les détails en production
  const message = config.isDev
    ? error.message
    : 'Une erreur interne est survenue';

  apiResponse.serverError(res, message);
}

// Gestion des erreurs Prisma spécifiques
function handlePrismaError(
  error: Prisma.PrismaClientKnownRequestError,
  res: Response
): void {
  switch (error.code) {
    case 'P2002': {
      // Violation de contrainte unique
      const field = (error.meta?.target as string[])?.join(', ') || 'champ';
      apiResponse.conflict(res, `Ce ${field} existe déjà`);
      break;
    }
    case 'P2003': {
      // Violation de clé étrangère
      apiResponse.badRequest(res, 'Référence invalide vers une autre ressource');
      break;
    }
    case 'P2025': {
      // Enregistrement non trouvé
      apiResponse.notFound(res, 'Ressource non trouvée');
      break;
    }
    case 'P2014': {
      // Violation de relation requise
      apiResponse.badRequest(res, 'Relation requise manquante');
      break;
    }
    default: {
      console.error('Erreur Prisma non gérée:', error.code, error.message);
      apiResponse.serverError(res, 'Erreur de base de données');
    }
  }
}

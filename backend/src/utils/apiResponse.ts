import { Response } from 'express';

// Types pour les réponses API
interface SuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

// Helpers pour les réponses standardisées
export const apiResponse = {
  // Succès avec données
  success<T>(
    res: Response,
    data: T,
    message?: string,
    statusCode = 200
  ): Response<ApiResponse<T>> {
    return res.status(statusCode).json({
      success: true,
      data,
      message,
    });
  },

  // Succès avec pagination
  paginated<T>(
    res: Response,
    data: T[],
    pagination: { page: number; limit: number; total: number }
  ): Response<ApiResponse<T[]>> {
    return res.status(200).json({
      success: true,
      data,
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.ceil(pagination.total / pagination.limit),
      },
    });
  },

  // Création réussie
  created<T>(res: Response, data: T, message = 'Ressource créée'): Response<ApiResponse<T>> {
    return res.status(201).json({
      success: true,
      data,
      message,
    });
  },

  // Pas de contenu (suppression)
  noContent(res: Response): Response {
    return res.status(204).send();
  },

  // Erreur générique
  error(
    res: Response,
    code: string,
    message: string,
    statusCode = 500,
    details?: unknown
  ): Response<ApiResponse<never>> {
    const errorObj: { code: string; message: string; details?: unknown } = {
      code,
      message,
    };
    if (details !== undefined) {
      errorObj.details = details;
    }
    return res.status(statusCode).json({
      success: false,
      error: errorObj,
    });
  },

  // Erreur 400 - Requête invalide
  badRequest(res: Response, message = 'Requête invalide', details?: unknown): Response<ApiResponse<never>> {
    return this.error(res, 'BAD_REQUEST', message, 400, details);
  },

  // Erreur 401 - Non authentifié
  unauthorized(res: Response, message = 'Non authentifié'): Response<ApiResponse<never>> {
    return this.error(res, 'UNAUTHORIZED', message, 401);
  },

  // Erreur 403 - Interdit
  forbidden(res: Response, message = 'Accès interdit'): Response<ApiResponse<never>> {
    return this.error(res, 'FORBIDDEN', message, 403);
  },

  // Erreur 404 - Non trouvé
  notFound(res: Response, message = 'Ressource non trouvée'): Response<ApiResponse<never>> {
    return this.error(res, 'NOT_FOUND', message, 404);
  },

  // Erreur 409 - Conflit
  conflict(res: Response, message = 'Conflit'): Response<ApiResponse<never>> {
    return this.error(res, 'CONFLICT', message, 409);
  },

  // Erreur 422 - Validation
  validationError(res: Response, details: unknown): Response<ApiResponse<never>> {
    return this.error(res, 'VALIDATION_ERROR', 'Erreur de validation', 422, details);
  },

  // Erreur 429 - Trop de requêtes
  tooManyRequests(res: Response, message = 'Trop de requêtes'): Response<ApiResponse<never>> {
    return this.error(res, 'TOO_MANY_REQUESTS', message, 429);
  },

  // Erreur 500 - Erreur serveur
  serverError(res: Response, message = 'Erreur interne du serveur'): Response<ApiResponse<never>> {
    return this.error(res, 'INTERNAL_ERROR', message, 500);
  },
};

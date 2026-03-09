import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { apiResponse } from '../utils/index.js';

/**
 * Middleware d'authentification par clé API (pour Google Apps Script, etc.)
 */
export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    apiResponse.unauthorized(res, 'Clé API manquante');
    return;
  }

  if (!config.apiKeys.google || apiKey !== config.apiKeys.google) {
    apiResponse.unauthorized(res, 'Clé API invalide');
    return;
  }

  next();
}

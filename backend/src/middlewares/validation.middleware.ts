import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { apiResponse } from '../utils/index.js';

// Middleware de validation générique
export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = req[source];
      const validated = schema.parse(data);

      // Remplacer les données par les données validées/transformées
      req[source] = validated;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        apiResponse.validationError(res, formattedErrors);
        return;
      }

      apiResponse.badRequest(res, 'Données invalides');
    }
  };
}

// Middleware pour valider plusieurs sources à la fois
export function validateMultiple(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const errors: { source: string; field: string; message: string }[] = [];

      if (schemas.body) {
        try {
          req.body = schemas.body.parse(req.body);
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(
              ...error.errors.map((err) => ({
                source: 'body',
                field: err.path.join('.'),
                message: err.message,
              }))
            );
          }
        }
      }

      if (schemas.query) {
        try {
          req.query = schemas.query.parse(req.query);
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(
              ...error.errors.map((err) => ({
                source: 'query',
                field: err.path.join('.'),
                message: err.message,
              }))
            );
          }
        }
      }

      if (schemas.params) {
        try {
          req.params = schemas.params.parse(req.params);
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(
              ...error.errors.map((err) => ({
                source: 'params',
                field: err.path.join('.'),
                message: err.message,
              }))
            );
          }
        }
      }

      if (errors.length > 0) {
        apiResponse.validationError(res, errors);
        return;
      }

      next();
    } catch {
      apiResponse.badRequest(res, 'Données invalides');
    }
  };
}

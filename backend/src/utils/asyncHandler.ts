import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrapper pour les contrôleurs async
 * Permet d'éviter les try/catch répétitifs en capturant automatiquement les erreurs
 */
export function asyncHandler<
  P = object,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = object,
>(
  fn: (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction
  ) => Promise<unknown>
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

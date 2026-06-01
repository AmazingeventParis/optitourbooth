import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Route de maintenance TEMPORAIRE — à supprimer après usage.
 * Protégée par un token simple (?token=...).
 *
 * Déverrouille des pending_points faussement verrouillés (manuallyEdited=true
 * posé par l'ancien bug du sync) pour qu'ils reprennent le formulaire client
 * au prochain sync. Cible précise par externalId.
 */

const MAINTENANCE_TOKEN = 'otb-unlock-2026-temp';

const router = Router();

function checkToken(req: Request, res: Response): boolean {
  if (req.query.token !== MAINTENANCE_TOKEN) {
    apiResponse.unauthorized(res, 'Token invalide');
    return false;
  }
  return true;
}

// POST /api/maintenance/unlock?token=...&prefix=smk_order_3906
// Déverrouille (manuallyEdited=false) les points dont l'externalId commence par prefix,
// uniquement s'ils sont non-dispatchés et non supprimés.
router.post(
  '/unlock',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const prefix = String(req.query.prefix || '');
    if (!prefix) {
      apiResponse.badRequest(res, 'prefix requis');
      return;
    }
    const result = await prisma.pendingPoint.updateMany({
      where: {
        externalId: { startsWith: prefix },
        dispatched: false,
        deletedByUser: false,
      },
      data: { manuallyEdited: false },
    });
    apiResponse.success(res, { unlocked: result.count, prefix });
  })
);

export default router;

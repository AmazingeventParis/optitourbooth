import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Route de maintenance TEMPORAIRE — à supprimer après usage.
 * Déverrouille les pending_points faussement verrouillés (manuallyEdited=true
 * posé par l'ancien bug du sync) pour qu'ils reprennent le formulaire client.
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

// POST /api/maintenance/unlock-all?token=...
// Déverrouille (manuallyEdited=false) tous les pending_points CRM non-dispatchés,
// non supprimés, futurs. Cible les faux verrous de l'ancien bug.
router.post(
  '/unlock-all',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const result = await prisma.pendingPoint.updateMany({
      where: {
        source: { in: ['crm_shootnbox', 'crm_smakk'] },
        manuallyEdited: true,
        dispatched: false,
        deletedByUser: false,
        date: { gte: today },
      },
      data: { manuallyEdited: false },
    });
    apiResponse.success(res, { unlocked: result.count });
  })
);

export default router;

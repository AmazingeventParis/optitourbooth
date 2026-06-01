import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Route de maintenance TEMPORAIRE — à supprimer après usage.
 * Soft-delete TOUS les pending_points source=google_calendar encore actifs
 * (GCal n'est plus une source depuis le 27/05). Sans filtre de date.
 */

const MAINTENANCE_TOKEN = 'otb-gcal-cleanup-2026-temp';

const router = Router();

function checkToken(req: Request, res: Response): boolean {
  if (req.query.token !== MAINTENANCE_TOKEN) {
    apiResponse.unauthorized(res, 'Token invalide');
    return false;
  }
  return true;
}

router.get(
  '/gcal-residuals',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const count = await prisma.pendingPoint.count({
      where: { source: 'google_calendar', deletedByUser: false },
    });
    apiResponse.success(res, { count });
  })
);

router.post(
  '/gcal-residuals/repair',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const result = await prisma.pendingPoint.updateMany({
      where: { source: 'google_calendar', deletedByUser: false },
      data: { deletedByUser: true, dispatched: true },
    });
    apiResponse.success(res, { softDeleted: result.count });
  })
);

export default router;

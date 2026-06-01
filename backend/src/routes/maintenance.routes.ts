import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Route de maintenance TEMPORAIRE — à supprimer après usage.
 * Protégée par un token simple (?token=...).
 *
 * Nettoyage des pending_points résiduels source=google_calendar : GCal n'est
 * plus une source depuis le 2026-05-27 (CRM Shootnbox+Smakk = source unique).
 * Tout point GCal encore actif est un doublon/résidu → soft-delete
 * (deletedByUser=true) pour le retirer du planning sans toucher aux points CRM,
 * manuels, ni aux tournées.
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

// GET audit (dry-run)
router.get(
  '/gcal-residuals',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const points = await prisma.pendingPoint.findMany({
      where: { source: 'google_calendar', deletedByUser: false },
      select: { id: true, date: true, type: true, clientName: true, dispatched: true },
      orderBy: { date: 'asc' },
    });
    apiResponse.success(res, {
      count: points.length,
      dispatchedCount: points.filter((p) => p.dispatched).length,
      sample: points.slice(0, 50).map((p) => ({
        date: p.date.toISOString().slice(0, 10),
        type: p.type,
        clientName: p.clientName,
        dispatched: p.dispatched,
      })),
    });
  })
);

// POST repair : soft-delete tous les résidus GCal
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

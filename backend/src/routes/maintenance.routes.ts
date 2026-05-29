import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Route de maintenance TEMPORAIRE — à supprimer après usage.
 * Protégée par un token simple (?token=...).
 *
 * "Points fantômes" = pending_points dispatched=true sans Point correspondant
 * dans une tournée active (match date+type+nom). Invisibles partout.
 *  - source CRM (crm_shootnbox/crm_smakk) : prestations réelles actuelles
 *    → on les remet en "à dispatcher" (dispatched=false).
 *  - source google_calendar : legacy (GCal désactivé le 2026-05-27), souvent
 *    doublons d'entrées CRM → on les soft-delete (deletedByUser=true) pour ne
 *    pas polluer le planning.
 */

const MAINTENANCE_TOKEN = 'otb-ghost-fix-2026-temp';

const router = Router();

function checkToken(req: Request, res: Response): boolean {
  if (req.query.token !== MAINTENANCE_TOKEN) {
    apiResponse.unauthorized(res, 'Token invalide');
    return false;
  }
  return true;
}

function norm(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatches(pendingName: string, societe: string | null, nom: string | null): boolean {
  const p = norm(pendingName);
  if (!p) return false;
  for (const c of [norm(societe), norm(nom)]) {
    if (!c) continue;
    if (p === c || p.includes(c) || c.includes(p)) return true;
  }
  return false;
}

async function findGhosts() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dispatched = await prisma.pendingPoint.findMany({
    where: { dispatched: true, deletedByUser: false, date: { gte: today } },
    select: { id: true, date: true, type: true, clientName: true, externalId: true, source: true },
  });
  if (dispatched.length === 0) return { ghosts: [], scanned: 0 };

  const minDate = dispatched.reduce((m, p) => (p.date < m ? p.date : m), dispatched[0]!.date);
  const points = await prisma.point.findMany({
    where: { tournee: { date: { gte: minDate }, statut: { not: 'annulee' } } },
    select: {
      type: true,
      tournee: { select: { date: true } },
      client: { select: { nom: true, societe: true } },
    },
  });

  const ghosts = dispatched.filter((pp) => {
    const ppDate = pp.date.toISOString().slice(0, 10);
    return !points.some(
      (pt) =>
        pt.tournee.date.toISOString().slice(0, 10) === ppDate &&
        pt.type === pp.type &&
        nameMatches(pp.clientName, pt.client.societe, pt.client.nom)
    );
  });
  return { ghosts, scanned: dispatched.length };
}

// GET audit (dry-run)
router.get(
  '/ghost-points',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const { ghosts, scanned } = await findGhosts();
    const crm = ghosts.filter((g) => g.source === 'crm_shootnbox' || g.source === 'crm_smakk');
    const gcal = ghosts.filter((g) => g.source === 'google_calendar');
    apiResponse.success(res, {
      scannedDispatched: scanned,
      ghostCount: ghosts.length,
      crmCount: crm.length,
      gcalCount: gcal.length,
      crm: crm.map((g) => ({ date: g.date.toISOString().slice(0, 10), type: g.type, clientName: g.clientName, externalId: g.externalId, source: g.source })),
    });
  })
);

// POST repair : CRM → un-dispatch ; GCal → soft-delete
router.post(
  '/ghost-points/repair',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const { ghosts, scanned } = await findGhosts();
    const crmIds = ghosts.filter((g) => g.source === 'crm_shootnbox' || g.source === 'crm_smakk').map((g) => g.id);
    const gcalIds = ghosts.filter((g) => g.source === 'google_calendar').map((g) => g.id);

    if (crmIds.length > 0) {
      await prisma.pendingPoint.updateMany({ where: { id: { in: crmIds } }, data: { dispatched: false } });
    }
    if (gcalIds.length > 0) {
      await prisma.pendingPoint.updateMany({ where: { id: { in: gcalIds } }, data: { deletedByUser: true } });
    }
    apiResponse.success(res, {
      scannedDispatched: scanned,
      crmRedispatched: crmIds.length,
      gcalSoftDeleted: gcalIds.length,
    });
  })
);

export default router;

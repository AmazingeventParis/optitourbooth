import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * Route de maintenance TEMPORAIRE — à supprimer après usage.
 * Protégée par un token simple passé en query (?token=...).
 *
 * Objectif : détecter et réparer les "points fantômes" — des pending_points
 * marqués dispatched=true alors qu'ils ne correspondent à AUCUN point dans une
 * tournée active. Ils sont invisibles partout (ni dans "à dispatcher", ni dans
 * une tournée). Cause : suppression d'un point/tournée sans remise à
 * dispatched=false (pas de lien Point↔PendingPoint en base — corrigé en phase 2).
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

// Normalise un nom pour le matching (minuscule, sans accents/espaces superflus)
function norm(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Un pending est "couvert" par un point de tournée si même date + même type + nom compatible
function nameMatches(pendingName: string, societe: string | null, nom: string | null): boolean {
  const p = norm(pendingName);
  if (!p) return false;
  const candidates = [norm(societe), norm(nom)].filter(Boolean);
  for (const c of candidates) {
    if (!c) continue;
    if (p === c || p.includes(c) || c.includes(p)) return true;
  }
  return false;
}

/**
 * Calcule la liste des fantômes : pending_points dispatched=true, non supprimés,
 * date >= aujourd'hui, sans point correspondant dans une tournée active.
 */
async function findGhosts() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dispatched = await prisma.pendingPoint.findMany({
    where: { dispatched: true, deletedByUser: false, date: { gte: today } },
    select: { id: true, date: true, type: true, clientName: true, externalId: true, source: true },
  });

  if (dispatched.length === 0) return { ghosts: [], scanned: 0 };

  // Charger tous les points des tournées actives sur la plage de dates concernée
  const minDate = dispatched.reduce((m, p) => (p.date < m ? p.date : m), dispatched[0]!.date);
  const points = await prisma.point.findMany({
    where: {
      tournee: { date: { gte: minDate }, statut: { not: 'annulee' } },
    },
    select: {
      type: true,
      tournee: { select: { date: true } },
      client: { select: { nom: true, societe: true } },
    },
  });

  const ghosts = dispatched.filter((pp) => {
    const ppDate = pp.date.toISOString().slice(0, 10);
    const covered = points.some(
      (pt) =>
        pt.tournee.date.toISOString().slice(0, 10) === ppDate &&
        pt.type === pp.type &&
        nameMatches(pp.clientName, pt.client.societe, pt.client.nom)
    );
    return !covered;
  });

  return { ghosts, scanned: dispatched.length };
}

// GET /api/maintenance/ghost-points?token=... → audit (dry-run, ne modifie rien)
router.get(
  '/ghost-points',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const { ghosts, scanned } = await findGhosts();
    apiResponse.success(res, {
      scannedDispatched: scanned,
      ghostCount: ghosts.length,
      ghosts: ghosts.map((g) => ({
        id: g.id,
        date: g.date.toISOString().slice(0, 10),
        type: g.type,
        clientName: g.clientName,
        externalId: g.externalId,
        source: g.source,
      })),
    });
  })
);

// POST /api/maintenance/ghost-points/repair?token=... → remet dispatched=false
router.post(
  '/ghost-points/repair',
  asyncHandler(async (req: Request, res: Response) => {
    if (!checkToken(req, res)) return;
    const { ghosts, scanned } = await findGhosts();
    const ids = ghosts.map((g) => g.id);
    if (ids.length > 0) {
      await prisma.pendingPoint.updateMany({
        where: { id: { in: ids } },
        data: { dispatched: false },
      });
    }
    apiResponse.success(res, {
      scannedDispatched: scanned,
      repaired: ids.length,
      ghosts: ghosts.map((g) => ({
        date: g.date.toISOString().slice(0, 10),
        type: g.type,
        clientName: g.clientName,
        externalId: g.externalId,
      })),
    });
  })
);

export default router;

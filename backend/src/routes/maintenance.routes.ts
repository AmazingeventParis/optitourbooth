import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

const SECRET = 'otb-cleanup-2026-temp';

function normalizeForMatch(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Route temporaire — à supprimer après usage
router.get('/cleanup-duplicates', async (req: Request, res: Response) => {
  if (req.query.token !== SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    // 1. Tous les pending_points non-dispatchés (toutes dates)
    const pendingPoints = await prisma.pendingPoint.findMany({
      where: { dispatched: false },
      select: { id: true, externalId: true, clientName: true, type: true, date: true },
    });

    // 2. Tous les points dans des tournées actives
    const tourneePoints = await prisma.point.findMany({
      where: {
        tournee: { statut: { not: 'annulee' } },
      },
      include: {
        client: { select: { nom: true, societe: true } },
        tournee: { select: { date: true } },
      },
    });

    const dispatchedList: { date: string; clientNorm: string; type: string }[] = [];
    for (const pt of tourneePoints) {
      const dateStr = pt.tournee.date.toISOString().substring(0, 10);
      const clientNorm = normalizeForMatch(pt.client.societe || pt.client.nom || '');
      dispatchedList.push({ date: dateStr, clientNorm, type: pt.type });
    }

    function isAlreadyDispatched(dateStr: string, clientNorm: string, type: string): boolean {
      for (const pt of dispatchedList) {
        if (pt.date !== dateStr || pt.type !== type) continue;
        if (!clientNorm || !pt.clientNorm) continue;
        if (pt.clientNorm === clientNorm) return true;
        // Substring match : "technicoflor" ⊂ "technicoflor+ plaque immatriculation"
        if (pt.clientNorm.includes(clientNorm) || clientNorm.includes(pt.clientNorm)) return true;
      }
      return false;
    }

    const toDelete: string[] = [];
    const report: any[] = [];

    for (const pp of pendingPoints) {
      const dateStr = pp.date.toISOString().substring(0, 10);
      const clientNorm = normalizeForMatch(pp.clientName || '');

      if (isAlreadyDispatched(dateStr, clientNorm, pp.type)) {
        toDelete.push(pp.id);
        report.push({
          id: pp.id,
          externalId: pp.externalId,
          clientName: pp.clientName,
          clientNorm,
          type: pp.type,
          date: dateStr,
        });
      }
    }

    let deleted = 0;
    if (toDelete.length > 0) {
      const result = await prisma.pendingPoint.deleteMany({
        where: { id: { in: toDelete } },
      });
      deleted = result.count;
    }

    res.json({
      pendingPointsChecked: pendingPoints.length,
      tourneePointsChecked: tourneePoints.length,
      duplicatesFound: toDelete.length,
      duplicatesDeleted: deleted,
      deleted: report,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

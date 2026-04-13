import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

const SECRET = 'otb-cleanup-2026-temp';

// Route temporaire — à supprimer après usage
router.get('/cleanup-duplicates', async (req: Request, res: Response) => {
  if (req.query.token !== SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  function normalizeForMatch(name: string): string {
    return name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  try {
    // 1. Charger tous les pending_points non-dispatchés à venir
    const pendingPoints = await prisma.pendingPoint.findMany({
      where: {
        dispatched: false,
        date: { gte: new Date() },
      },
      select: { id: true, externalId: true, clientName: true, type: true, date: true },
    });

    // 2. Charger tous les points dans des tournées actives à venir
    const tourneePoints = await prisma.point.findMany({
      where: {
        tournee: {
          date: { gte: new Date('2026-04-01') },
          statut: { not: 'annulee' },
        },
      },
      include: {
        client: { select: { nom: true, societe: true } },
        tournee: { select: { date: true } },
      },
    });

    // Construire un Set normalisé date|clientNorm|type
    const dispatched = new Set<string>();
    for (const pt of tourneePoints) {
      const dateStr = pt.tournee.date.toISOString().substring(0, 10);
      const clientNorm = normalizeForMatch(pt.client.societe || pt.client.nom || '');
      dispatched.add(`${dateStr}|${clientNorm}|${pt.type}`);
    }

    // 3. Identifier les doublons
    const toDelete: string[] = [];
    const report: any[] = [];

    for (const pp of pendingPoints) {
      const dateStr = pp.date.toISOString().substring(0, 10);
      const clientNorm = normalizeForMatch(pp.clientName || '');
      const key = `${dateStr}|${clientNorm}|${pp.type}`;

      if (dispatched.has(key)) {
        toDelete.push(pp.id);
        report.push({
          id: pp.id,
          externalId: pp.externalId,
          clientName: pp.clientName,
          clientNorm,
          type: pp.type,
          date: dateStr,
          action: 'DELETED',
        });
      }
    }

    // 4. Supprimer les doublons
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
      details: report,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

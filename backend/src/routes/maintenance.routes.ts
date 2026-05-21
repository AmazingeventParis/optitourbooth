import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';

const router = Router();
const TOKEN = 'otb-diag-fuji-2026';

router.get('/fuji-diag', async (req: Request, res: Response) => {
  if (req.headers['x-maint-token'] !== TOKEN) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const dateStart = new Date('2026-05-29T00:00:00Z');
  const dateEnd = new Date('2026-05-29T23:59:59Z');

  const points = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: dateStart, lte: dateEnd },
      clientName: { contains: 'FUJI', mode: 'insensitive' },
    },
    select: {
      id: true,
      externalId: true,
      clientName: true,
      type: true,
      source: true,
      dispatched: true,
      deletedByUser: true,
      date: true,
    },
  });

  // Also check all 29.05 CRM points
  const allCrm = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: dateStart, lte: dateEnd },
      source: { in: ['crm_shootnbox', 'crm_smakk'] },
    },
    select: {
      id: true,
      externalId: true,
      clientName: true,
      type: true,
      source: true,
      dispatched: true,
      deletedByUser: true,
    },
    orderBy: { clientName: 'asc' },
  });

  // All GCal points on 29.05
  const gcal = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: dateStart, lte: dateEnd },
      source: 'google_calendar',
    },
    select: {
      id: true,
      externalId: true,
      clientName: true,
      type: true,
      dispatched: true,
      deletedByUser: true,
    },
    orderBy: { clientName: 'asc' },
  });

  res.json({ fujiPoints: points, crmPoints29: allCrm, gcalPoints29: gcal });
});

router.post('/fuji-reset', async (req: Request, res: Response) => {
  if (req.headers['x-maint-token'] !== TOKEN) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const dateStart = new Date('2026-05-29T00:00:00Z');
  const dateEnd = new Date('2026-05-29T23:59:59Z');

  const updated = await prisma.pendingPoint.updateMany({
    where: {
      date: { gte: dateStart, lte: dateEnd },
      clientName: { contains: 'FUJI', mode: 'insensitive' },
      source: { in: ['crm_shootnbox', 'crm_smakk'] },
    },
    data: { dispatched: false, deletedByUser: false },
  });

  res.json({ reset: updated.count });
});

export default router;

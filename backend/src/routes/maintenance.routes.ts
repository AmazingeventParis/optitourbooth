import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';

const router = Router();
const SECRET = 'otb-bds-diag-2026';

router.get('/bds-diag', async (req: Request, res: Response) => {
  if (req.headers['x-maintenance-token'] !== SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const points = await prisma.pendingPoint.findMany({
      where: {
        OR: [
          { clientName: { contains: 'CentraleSupelec', mode: 'insensitive' } },
          { clientName: { contains: 'CentraleSupélec', mode: 'insensitive' } },
          { clientName: { contains: 'BDS Centrale', mode: 'insensitive' } },
        ],
      },
      orderBy: { date: 'asc' },
    });
    return res.json({ count: points.length, points });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete('/bds-delete', async (req: Request, res: Response) => {
  if (req.headers['x-maintenance-token'] !== SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const deleted = await prisma.pendingPoint.deleteMany({
      where: {
        OR: [
          { clientName: { contains: 'CentraleSupelec', mode: 'insensitive' } },
          { clientName: { contains: 'CentraleSupélec', mode: 'insensitive' } },
          { clientName: { contains: 'BDS Centrale', mode: 'insensitive' } },
        ],
        date: {
          gte: new Date('2026-05-07'),
          lte: new Date('2026-05-11T23:59:59Z'),
        },
      },
    });
    const deletedBookings = await prisma.booking.deleteMany({
      where: {
        OR: [
          { customerName: { contains: 'CentraleSupelec', mode: 'insensitive' } },
          { customerName: { contains: 'CentraleSupélec', mode: 'insensitive' } },
          { customerName: { contains: 'BDS Centrale', mode: 'insensitive' } },
        ],
      },
    });
    return res.json({ deletedPendingPoints: deleted.count, deletedBookings: deletedBookings.count });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;

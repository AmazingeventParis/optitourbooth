import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

// Route de diagnostic temporaire — token jetable.
const TOKEN = 'otb-diag-dewinne-2026';

router.get('/diag', async (req: Request, res: Response) => {
  if (req.query.token !== TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const q = String(req.query.q || 'winne').toLowerCase();

  try {
    // 1. pending_points correspondant au nom client
    const pending = await prisma.pendingPoint.findMany({
      where: { clientName: { contains: q, mode: 'insensitive' } },
      select: {
        id: true, date: true, clientName: true, eventName: true, type: true,
        source: true, externalId: true, adresse: true, creneauDebut: true,
        creneauFin: true, contactNom: true, contactTelephone: true, notes: true,
        produitNom: true, dispatched: true, manuallyEdited: true, deletedByUser: true,
        quantiteBornes: true, updatedAt: true,
      },
      orderBy: { date: 'asc' },
    });

    // 2. Points (déjà dans des tournées) du client
    const points = await prisma.point.findMany({
      where: {
        client: { OR: [
          { nom: { contains: q, mode: 'insensitive' } },
          { societe: { contains: q, mode: 'insensitive' } },
        ] },
      },
      select: {
        id: true, type: true, adresse: true, creneauDebut: true, creneauFin: true,
        quantiteBornes: true, notesClient: true, notesInternes: true, updatedAt: true,
        client: { select: { nom: true, societe: true, adresse: true, contactNom: true, contactTelephone: true } },
        tournee: { select: { id: true, date: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({ q, pendingCount: pending.length, pointsCount: points.length, pending, points });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;

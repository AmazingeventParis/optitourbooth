import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * GET /api/billing/configs
 * List all billing configs with user info
 */
export const getConfigs = asyncHandler(async (_req: Request, res: Response) => {
  // Get all chauffeurs + admins
  const users = await prisma.user.findMany({
    where: {
      actif: true,
      roles: { hasSome: ['chauffeur', 'admin'] },
    },
    select: {
      id: true,
      nom: true,
      prenom: true,
      roles: true,
      couleur: true,
      billingConfig: true,
    },
    orderBy: { nom: 'asc' },
  });

  const result = users.map((u) => ({
    userId: u.id,
    nom: u.nom,
    prenom: u.prenom,
    roles: u.roles,
    couleur: u.couleur,
    config: u.billingConfig || {
      tarifPointHorsForfait: 0,
      tarifHeureSupp: 0,
      horsForfaitDebut: '18:00',
      horsForfaitFin: '07:00',
      customItems: [],
    },
  }));

  return apiResponse.success(res, result);
});

/**
 * PUT /api/billing/configs/:userId
 * Upsert a user's billing config
 */
export const upsertConfig = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { tarifPointHorsForfait, tarifHeureSupp, horsForfaitDebut, horsForfaitFin, customItems } = req.body;

  // Validate user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return apiResponse.notFound(res, 'Utilisateur non trouvé');

  const config = await prisma.billingConfig.upsert({
    where: { userId },
    update: {
      tarifPointHorsForfait: tarifPointHorsForfait ?? 0,
      tarifHeureSupp: tarifHeureSupp ?? 0,
      horsForfaitDebut: horsForfaitDebut || '18:00',
      horsForfaitFin: horsForfaitFin || '07:00',
      customItems: customItems || [],
    },
    create: {
      userId: userId!,
      tarifPointHorsForfait: tarifPointHorsForfait ?? 0,
      tarifHeureSupp: tarifHeureSupp ?? 0,
      horsForfaitDebut: horsForfaitDebut || '18:00',
      horsForfaitFin: horsForfaitFin || '07:00',
      customItems: customItems || [],
    },
  });

  return apiResponse.success(res, config);
});

/**
 * GET /api/billing/entries
 * List billing entries with filters
 */
export const getEntries = asyncHandler(async (req: Request, res: Response) => {
  const { userId, dateFrom, dateTo, page = '1', limit = '50' } = req.query as Record<string, string>;

  const where: any = {};
  if (userId) where.userId = userId;
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = new Date(dateFrom + 'T00:00:00Z');
    if (dateTo) where.date.lte = new Date(dateTo + 'T23:59:59Z');
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

  const [entries, total] = await Promise.all([
    prisma.billingEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.billingEntry.count({ where }),
  ]);

  // Get user names for display
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, nom: true, prenom: true, couleur: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const enriched = entries.map((e) => ({
    ...e,
    user: userMap.get(e.userId) || null,
  }));

  // Compute total sum for current filters
  const totalSum = await prisma.billingEntry.aggregate({
    where,
    _sum: { totalPrice: true },
  });

  return res.status(200).json({
    success: true,
    data: enriched,
    meta: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      totalSum: totalSum._sum.totalPrice || 0,
    },
  });
});

/**
 * POST /api/billing/entries
 * Create a manual billing entry
 */
export const createEntry = asyncHandler(async (req: Request, res: Response) => {
  const { userId, date, type, label, quantity, unitPrice, tourneeId, pointId } = req.body;

  const qty = quantity || 1;
  const total = qty * unitPrice;

  const entry = await prisma.billingEntry.create({
    data: {
      userId,
      date: new Date(date + 'T12:00:00Z'),
      type: type || 'custom',
      label,
      quantity: qty,
      unitPrice,
      totalPrice: total,
      tourneeId: tourneeId || null,
      pointId: pointId || null,
    },
  });

  return apiResponse.success(res, entry);
});

/**
 * DELETE /api/billing/entries/:id
 */
export const deleteEntry = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.billingEntry.delete({ where: { id } });
    return apiResponse.success(res, { message: 'Entrée supprimée' });
  } catch {
    return apiResponse.notFound(res, 'Entrée non trouvée');
  }
});

/**
 * Check if a time (HH:MM) falls within the off-hours range
 * Handles overnight ranges (e.g. 18:00 - 07:00)
 */
function isTimeInRange(time: string, debut: string, fin: string): boolean {
  const t = timeToMinutes(time);
  const d = timeToMinutes(debut);
  const f = timeToMinutes(fin);

  if (d <= f) {
    // Same day range (e.g. 09:00 - 17:00)
    return t >= d && t <= f;
  } else {
    // Overnight range (e.g. 18:00 - 07:00)
    return t >= d || t <= f;
  }
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + (m || 0);
}

function formatTimeFromDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * POST /api/billing/compute
 * Auto-compute billing entries for a date range
 */
export const computeEntries = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo, userId } = req.body;

  if (!dateFrom || !dateTo) {
    return apiResponse.badRequest(res, 'dateFrom et dateTo requis');
  }

  const fromDate = new Date(dateFrom + 'T00:00:00Z');
  const toDate = new Date(dateTo + 'T23:59:59Z');

  // Get billing configs
  const configWhere: any = {};
  if (userId) configWhere.userId = userId;
  const configs = await prisma.billingConfig.findMany({ where: configWhere });
  const configMap = new Map(configs.map((c) => [c.userId, c]));

  if (configs.length === 0) {
    return apiResponse.success(res, { created: 0, message: 'Aucune grille tarifaire configurée' });
  }

  // Get tours in date range for configured users
  const userIds = configs.map((c) => c.userId);
  const tournees = await prisma.tournee.findMany({
    where: {
      date: { gte: fromDate, lte: toDate },
      chauffeurId: { in: userIds },
    },
    include: {
      chauffeur: { select: { nom: true, prenom: true } },
      points: {
        include: {
          client: { select: { nom: true } },
        },
      },
    },
  });

  let created = 0;

  for (const tournee of tournees) {
    const config = configMap.get(tournee.chauffeurId);
    if (!config) continue;

    const dateStr = tournee.date.toISOString().substring(0, 10);

    // Check points for off-hours
    if (config.tarifPointHorsForfait > 0 && config.horsForfaitDebut && config.horsForfaitFin) {
      for (const point of tournee.points) {
        // Use actual arrival time, or scheduled time slot
        const timeToCheck = point.heureArriveeReelle
          ? formatTimeFromDate(point.heureArriveeReelle)
          : point.creneauDebut
            ? formatTimeFromDate(point.creneauDebut)
            : null;

        if (!timeToCheck) continue;

        if (isTimeInRange(timeToCheck, config.horsForfaitDebut, config.horsForfaitFin)) {
          // Check if entry already exists
          const existing = await prisma.billingEntry.findFirst({
            where: { pointId: point.id, type: 'point_hors_forfait' },
          });
          if (existing) continue;

          await prisma.billingEntry.create({
            data: {
              userId: tournee.chauffeurId,
              tourneeId: tournee.id,
              pointId: point.id,
              date: tournee.date,
              type: 'point_hors_forfait',
              label: `Point HF - ${point.client.nom} (${timeToCheck})`,
              quantity: 1,
              unitPrice: config.tarifPointHorsForfait,
              totalPrice: config.tarifPointHorsForfait,
              metadata: { time: timeToCheck, clientName: point.client.nom },
            },
          });
          created++;
        }
      }
    }

    // Check overtime hours
    if (config.tarifHeureSupp > 0 && tournee.heureFinReelle && config.horsForfaitDebut) {
      const finReelle = formatTimeFromDate(tournee.heureFinReelle);
      const limitEnd = config.horsForfaitDebut; // e.g. "18:00"

      const finMinutes = timeToMinutes(finReelle);
      const limitMinutes = timeToMinutes(limitEnd);

      if (finMinutes > limitMinutes) {
        const overtimeMinutes = finMinutes - limitMinutes;
        const overtimeHours = Math.ceil(overtimeMinutes / 60 * 10) / 10; // round to 0.1

        const existing = await prisma.billingEntry.findFirst({
          where: { tourneeId: tournee.id, userId: tournee.chauffeurId, type: 'heure_supp' },
        });
        if (!existing) {
          await prisma.billingEntry.create({
            data: {
              userId: tournee.chauffeurId,
              tourneeId: tournee.id,
              date: tournee.date,
              type: 'heure_supp',
              label: `Heures supp - ${dateStr} (${limitEnd} → ${finReelle})`,
              quantity: overtimeHours,
              unitPrice: config.tarifHeureSupp,
              totalPrice: overtimeHours * config.tarifHeureSupp,
              metadata: { scheduledEnd: limitEnd, actualEnd: finReelle, overtimeMinutes },
            },
          });
          created++;
        }
      }
    }
  }

  return apiResponse.success(res, { created, message: `${created} entrée(s) créée(s)` });
});

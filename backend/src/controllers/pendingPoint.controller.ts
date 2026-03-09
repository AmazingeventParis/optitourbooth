import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { ensureDateUTC } from '../utils/dateUtils.js';
import { syncGoogleCalendarEvents } from '../services/googleCalendar.service.js';

/**
 * POST /api/pending-points - Créer des points à dispatcher (appelé par Google Apps Script)
 */
export async function createPendingPoints(req: Request, res: Response): Promise<void> {
  const { points } = req.body;

  if (!points || !Array.isArray(points) || points.length === 0) {
    apiResponse.badRequest(res, 'Le champ "points" est requis (tableau non vide)');
    return;
  }

  const results = [];

  for (const point of points) {
    if (!point.date || !point.clientName || !point.type) {
      results.push({ error: 'Champs requis: date, clientName, type', point });
      continue;
    }

    try {
      const data = {
        date: ensureDateUTC(point.date),
        clientName: point.clientName,
        adresse: point.adresse || null,
        type: point.type,
        creneauDebut: point.creneauDebut || null,
        creneauFin: point.creneauFin || null,
        notes: point.notes || null,
        contactNom: point.contactNom || null,
        contactTelephone: point.contactTelephone || null,
        source: point.source || 'google_calendar',
        externalId: point.externalId || null,
      };

      let created;
      if (data.externalId) {
        // Upsert par externalId pour l'idempotence
        created = await prisma.pendingPoint.upsert({
          where: { externalId: data.externalId },
          update: {
            date: data.date,
            clientName: data.clientName,
            adresse: data.adresse,
            type: data.type,
            creneauDebut: data.creneauDebut,
            creneauFin: data.creneauFin,
            notes: data.notes,
            contactNom: data.contactNom,
            contactTelephone: data.contactTelephone,
          },
          create: data,
        });
      } else {
        created = await prisma.pendingPoint.create({ data });
      }

      results.push(created);
    } catch (error) {
      console.error('Erreur création pending point:', error);
      results.push({ error: (error as Error).message, point });
    }
  }

  apiResponse.success(res, {
    total: points.length,
    created: results.filter((r: any) => r.id).length,
    errors: results.filter((r: any) => r.error).length,
    results,
  });
}

/**
 * GET /api/pending-points?date=YYYY-MM-DD - Lister les points à dispatcher pour une date
 */
export async function listPendingPoints(req: Request, res: Response): Promise<void> {
  const { date } = req.query;

  if (!date || typeof date !== 'string') {
    apiResponse.badRequest(res, 'Paramètre "date" requis (YYYY-MM-DD)');
    return;
  }

  const dateStart = ensureDateUTC(date);
  const dateEnd = new Date(date + 'T23:59:59.999Z');

  const points = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: dateStart, lte: dateEnd },
      dispatched: false,
    },
    orderBy: { createdAt: 'asc' },
  });

  apiResponse.success(res, points);
}

/**
 * DELETE /api/pending-points/:id
 */
export async function deletePendingPoint(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    await prisma.pendingPoint.delete({ where: { id } });
    apiResponse.success(res, { message: 'Point supprimé' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/pending-points/:id/dispatch - Marquer comme dispatché
 */
export async function markDispatched(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    const updated = await prisma.pendingPoint.update({
      where: { id },
      data: { dispatched: true },
    });
    apiResponse.success(res, updated);
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * POST /api/pending-points/sync-google-calendar - Lancer une sync manuelle
 */
export async function syncGoogleCalendar(_req: Request, res: Response): Promise<void> {
  try {
    const result = await syncGoogleCalendarEvents();
    apiResponse.success(res, result);
  } catch (error) {
    apiResponse.error(res, `Erreur sync Google Calendar: ${(error as Error).message}`);
  }
}

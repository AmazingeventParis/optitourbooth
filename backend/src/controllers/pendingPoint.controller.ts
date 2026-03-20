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
        produitNom: point.produitNom || null,
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
 * POST /api/pending-points/manual - Créer un point à dispatcher manuellement (admin)
 */
export async function createManualPendingPoint(req: Request, res: Response): Promise<void> {
  const { date, clientName, adresse, type, produitNom, creneauDebut, creneauFin, notes, contactNom, contactTelephone } = req.body;

  if (!date || !clientName || !type) {
    apiResponse.badRequest(res, 'Champs requis: date, clientName, type');
    return;
  }

  const point = await prisma.pendingPoint.create({
    data: {
      date: ensureDateUTC(date),
      clientName,
      adresse: adresse || null,
      type,
      produitNom: produitNom || null,
      creneauDebut: creneauDebut || null,
      creneauFin: creneauFin || null,
      notes: notes || null,
      contactNom: contactNom || null,
      contactTelephone: contactTelephone || null,
      source: 'manual',
    },
  });

  apiResponse.success(res, point);
}

/**
 * GET /api/pending-points?date=YYYY-MM-DD - Lister les points à dispatcher pour une date
 */
export async function listPendingPoints(req: Request, res: Response): Promise<void> {
  const { date, search } = req.query;

  // Mode recherche par nom (admin debug)
  if (search && typeof search === 'string') {
    const points = await prisma.pendingPoint.findMany({
      where: {
        clientName: { contains: search, mode: 'insensitive' },
      },
      orderBy: { date: 'asc' },
    });
    apiResponse.success(res, points);
    return;
  }

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
 * PATCH /api/pending-points/:id - Mettre à jour un pending point (édition frontend)
 */
export async function updatePendingPoint(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { clientName, adresse, type, date, creneauDebut, creneauFin, contactNom, contactTelephone, notes, produitNom, dispatched } = req.body;

  try {
    const updated = await prisma.pendingPoint.update({
      where: { id },
      data: {
        ...(clientName !== undefined && { clientName }),
        ...(adresse !== undefined && { adresse }),
        ...(type !== undefined && { type }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(creneauDebut !== undefined && { creneauDebut }),
        ...(creneauFin !== undefined && { creneauFin }),
        ...(contactNom !== undefined && { contactNom }),
        ...(contactTelephone !== undefined && { contactTelephone }),
        ...(notes !== undefined && { notes }),
        ...(produitNom !== undefined && { produitNom }),
        ...(dispatched !== undefined && { dispatched }),
      },
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
 * GET /api/pending-points/calendar-events?calendarType=shootnbox|smakk
 * Liste les événements Google Calendar uniques (groupés par événement)
 * pour le panneau de préparations. Date: aujourd'hui → +15 jours.
 * Exclut les événements déjà utilisés dans une préparation.
 */
export async function listCalendarEvents(req: Request, res: Response): Promise<void> {
  const { calendarType } = req.query;

  const now = new Date();
  const dateStart = ensureDateUTC(now.toISOString().substring(0, 10));
  const dateEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

  // Filtre par calendrier source
  const smakkCalendarId = 'faa39fa21157c487ef3a5007739b04b69a9309cffee9d8bfc4ff09c75958bbd1@group.calendar.google.com';
  let calendarFilter: any = {};
  if (calendarType === 'smakk') {
    calendarFilter = { calendarId: smakkCalendarId };
  } else if (calendarType === 'shootnbox') {
    calendarFilter = { OR: [{ calendarId: { not: smakkCalendarId } }, { calendarId: null }] };
  }

  const points = await prisma.pendingPoint.findMany({
    where: {
      source: 'google_calendar',
      date: { gte: dateStart, lte: dateEnd },
      usedInPreparation: false,
      ignoredInPreparation: false,
      type: 'livraison',
      ...calendarFilter,
    },
    orderBy: { date: 'asc' },
  });

  // Retourner les événements avec date, client et suggestion de borne
  const events = points.map((p: any) => ({
    id: p.id,
    date: p.date,
    clientName: p.clientName,
    produitNom: p.produitNom,
    adresse: p.adresse,
    externalId: p.externalId,
    suggestedMachineId: p.suggestedMachineId || null,
  }));

  apiResponse.success(res, events);
}

/**
 * PATCH /api/pending-points/:id/use-in-preparation - Marquer comme utilisé dans une préparation
 */
export async function markUsedInPreparation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    // Marquer le point livraison
    const point = await prisma.pendingPoint.update({
      where: { id },
      data: { usedInPreparation: true },
    });

    // Marquer aussi le point ramassage associé (même externalId racine)
    if (point.externalId) {
      const eventIdBase = point.externalId.replace(/_livraison$/, '').replace(/_ramassage$/, '');
      await prisma.pendingPoint.updateMany({
        where: {
          externalId: { startsWith: eventIdBase },
          usedInPreparation: false,
        },
        data: { usedInPreparation: true },
      });
    }

    apiResponse.success(res, { message: 'Événement marqué comme utilisé' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/pending-points/:id/ignore-suggestion - Ignorer la suggestion de préparation
 */
export async function ignoreSuggestion(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    await prisma.pendingPoint.update({
      where: { id },
      data: { ignoredInPreparation: true },
    });

    apiResponse.success(res, { message: 'Suggestion ignorée' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/pending-points/:id/restore-suggestion - Restaurer une suggestion ignorée
 */
export async function restoreSuggestion(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    await prisma.pendingPoint.update({
      where: { id },
      data: { ignoredInPreparation: false },
    });

    apiResponse.success(res, { message: 'Suggestion restaurée' });
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
    apiResponse.error(res, 'SYNC_ERROR', `Erreur sync Google Calendar: ${(error as Error).message}`, 500);
  }
}

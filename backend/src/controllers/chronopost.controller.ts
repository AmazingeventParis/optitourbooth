import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { trackParcel, inferStatutFromSignificantEvent } from '../services/chronopost.service.js';
import { saveSession, getSessionStatus } from '../services/chronotraceApi.service.js';
import { syncChronopostAuto, reconcileReturnParcels } from '../services/chronopostSync.service.js';
import { ChronopostStatut } from '@prisma/client';

export async function listExpeditions(req: Request, res: Response): Promise<void> {
  const expeditions = await prisma.chronopostExpedition.findMany({
    orderBy: { dateDepart: 'desc' },
  });
  apiResponse.success(res, expeditions);
}

export async function getExpedition(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const exp = await prisma.chronopostExpedition.findUnique({ where: { id } });
  if (!exp) { apiResponse.notFound(res, 'Expédition non trouvée'); return; }
  apiResponse.success(res, exp);
}

// Add a single parcel by tracking number
export async function addExpedition(req: Request, res: Response): Promise<void> {
  const { numeroColis, clientNom } = req.body;

  if (!numeroColis?.trim()) {
    apiResponse.badRequest(res, 'Numéro de colis requis');
    return;
  }

  const num = (numeroColis as string).trim().toUpperCase();

  const existing = await prisma.chronopostExpedition.findUnique({ where: { numeroColis: num } });
  if (existing) {
    apiResponse.badRequest(res, 'Ce numéro de colis est déjà enregistré');
    return;
  }

  const result = await trackParcel(num);

  const lastEvent = result.events[result.events.length - 1];
  const statut = inferStatutFromSignificantEvent(
    lastEvent ? { code: lastEvent.code, eventDate: lastEvent.date, eventLabel: lastEvent.libelle } : undefined,
  ) as ChronopostStatut;

  // Earliest event = depot date
  const sortedDates = result.events.map(e => e.date).filter(Boolean).sort();
  const dateDepart = sortedDates[0] ? new Date(sortedDates[0]) : null;

  const expedition = await prisma.chronopostExpedition.create({
    data: {
      numeroColis: num,
      clientNom: clientNom?.trim() || result.recipientName || 'Inconnu',
      clientVille: result.recipientCity || null,
      dateDepart,
      statut,
      trackingData: result as any,
    },
  });

  apiResponse.success(res, expedition);
}

export async function updateExpedition(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { produitNom, dateRetourPrevu, dateRetourReel, numeroColisRetour, statut, notes, clientNom } = req.body;

  const exp = await prisma.chronopostExpedition.findUnique({ where: { id } });
  if (!exp) { apiResponse.notFound(res, 'Expédition non trouvée'); return; }

  const updateData: Record<string, any> = {
    ...(produitNom !== undefined && { produitNom }),
    ...(clientNom !== undefined && { clientNom }),
    ...(dateRetourPrevu !== undefined && { dateRetourPrevu: dateRetourPrevu ? new Date(dateRetourPrevu) : null }),
    ...(dateRetourReel !== undefined && { dateRetourReel: dateRetourReel ? new Date(dateRetourReel) : null }),
    ...(numeroColisRetour !== undefined && { numeroColisRetour }),
    ...(statut !== undefined && { statut: statut as ChronopostStatut }),
    ...(notes !== undefined && { notes }),
  };

  // When a return tracking number is being linked for the first time, auto-merge the standalone return record
  if (numeroColisRetour && numeroColisRetour !== exp.numeroColisRetour) {
    const returnRecord = await prisma.chronopostExpedition.findUnique({
      where: { numeroColis: numeroColisRetour },
    });
    if (returnRecord) {
      // Copy return pickup date from return parcel's departure (client handed it over)
      if (!updateData.dateRetourPrevu && !exp.dateRetourPrevu && returnRecord.dateDepart) {
        updateData.dateRetourPrevu = returnRecord.dateDepart;
      }
      // If return parcel is already delivered back to us, set real return date
      if (returnRecord.statut === 'rentre') {
        if (!updateData.dateRetourReel && !exp.dateRetourReel) {
          updateData.dateRetourReel = (returnRecord as any).dateLivraisonReelle || returnRecord.dateRetourReel || null;
        }
        if (!updateData.statut) updateData.statut = 'rentre' as ChronopostStatut;
      }
      // Remove the now-linked standalone return record
      await prisma.chronopostExpedition.delete({ where: { id: returnRecord.id } });
      console.log(`[Chronopost] Merged return ${numeroColisRetour} into outbound ${exp.numeroColis}`);
    }
  }

  const updated = await prisma.chronopostExpedition.update({
    where: { id },
    data: updateData,
  });

  apiResponse.success(res, updated);
}

export async function deleteExpedition(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const exp = await prisma.chronopostExpedition.findUnique({ where: { id } });
  if (!exp) { apiResponse.notFound(res, 'Expédition non trouvée'); return; }
  await prisma.chronopostExpedition.delete({ where: { id } });
  apiResponse.success(res, { message: 'Supprimée' });
}

// Sync full tracking history for a single parcel
export async function syncExpedition(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const exp = await prisma.chronopostExpedition.findUnique({ where: { id } });
  if (!exp) { apiResponse.notFound(res, 'Expédition non trouvée'); return; }

  const result = await trackParcel(exp.numeroColis);

  const lastEvent = result.events[result.events.length - 1];
  let statut: ChronopostStatut = exp.statut;
  if (exp.statut !== 'rentre') {
    statut = inferStatutFromSignificantEvent(
      lastEvent ? { code: lastEvent.code, eventDate: lastEvent.date, eventLabel: lastEvent.libelle } : undefined
    ) as ChronopostStatut;
  }

  const dateDepart = exp.dateDepart ?? (result.events[0]?.date ? new Date(result.events[0].date) : null);
  const clientNom = result.recipientName && result.recipientName !== 'Inconnu' ? result.recipientName : exp.clientNom;
  const clientVille = result.recipientCity || exp.clientVille;

  const updated = await prisma.chronopostExpedition.update({
    where: { id },
    data: { trackingData: result as any, statut, dateDepart, clientNom, clientVille },
  });

  apiResponse.success(res, updated);
}

export async function markAsReturned(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const exp = await prisma.chronopostExpedition.findUnique({ where: { id } });
  if (!exp) { apiResponse.notFound(res, 'Expédition non trouvée'); return; }

  const updated = await prisma.chronopostExpedition.update({
    where: { id },
    data: { statut: 'rentre', dateRetourReel: new Date() },
  });
  apiResponse.success(res, updated);
}

export async function updateChronotraceSession(req: Request, res: Response): Promise<void> {
  const { cookies } = req.body;
  if (!cookies?.trim()) {
    apiResponse.badRequest(res, 'Cookies requis');
    return;
  }
  await saveSession(cookies.trim());
  apiResponse.success(res, { message: 'Session Chronotrace mise à jour' });
}

export async function getChronotraceSessionStatus(req: Request, res: Response): Promise<void> {
  const status = await getSessionStatus();
  apiResponse.success(res, status);
}

export async function syncAll(req: Request, res: Response): Promise<void> {
  await syncChronopostAuto(); // includes reconcileReturnParcels() at the end
  const expeditions = await prisma.chronopostExpedition.findMany({ orderBy: { dateDepart: 'desc' } });
  apiResponse.success(res, expeditions);
}

export async function reconcile(req: Request, res: Response): Promise<void> {
  await reconcileReturnParcels();
  const expeditions = await prisma.chronopostExpedition.findMany({ orderBy: { dateDepart: 'desc' } });
  apiResponse.success(res, expeditions);
}

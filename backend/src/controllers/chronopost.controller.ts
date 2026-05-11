import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { searchByAccount, trackParcel, inferStatutFromSignificantEvent } from '../services/chronopost.service.js';
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

// Import all parcels from Chronopost account for a date range
export async function syncFromAccount(req: Request, res: Response): Promise<void> {
  const { dateDebut, dateFin } = req.body;

  const end = dateFin ? new Date(dateFin) : new Date();
  const start = dateDebut ? new Date(dateDebut) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Chronopost expects YYYY-MM-DDTHH:mm:ss
  const toChronoDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '');

  const result = await searchByAccount(toChronoDate(start), toChronoDate(end));

  if (result.errorCode !== '0' && result.errorCode !== '000') {
    apiResponse.badRequest(res, `Erreur Chronopost (${result.errorCode}): ${result.errorMessage}`);
    return;
  }

  let created = 0;
  let updated = 0;

  for (const parcel of result.parcels) {
    const statut = inferStatutFromSignificantEvent(parcel.significantEvent) as ChronopostStatut;
    const dateDepart = parcel.dateDeposit ? new Date(parcel.dateDeposit) : null;

    const existing = await prisma.chronopostExpedition.findUnique({
      where: { numeroColis: parcel.skybillNumber },
    });

    if (existing) {
      await prisma.chronopostExpedition.update({
        where: { numeroColis: parcel.skybillNumber },
        data: {
          clientNom: parcel.recipientName || existing.clientNom,
          clientVille: parcel.recipientCity || existing.clientVille,
          dateDepart: dateDepart || existing.dateDepart,
          // Never overwrite manual "rentré" status
          statut: existing.statut === 'rentre' ? 'rentre' : statut,
          trackingData: { significantEvent: parcel.significantEvent } as any,
        },
      });
      updated++;
    } else {
      await prisma.chronopostExpedition.create({
        data: {
          numeroColis: parcel.skybillNumber,
          clientNom: parcel.recipientName || 'Inconnu',
          clientVille: parcel.recipientCity || null,
          clientAdresse: parcel.recipientZipCode ? `CP ${parcel.recipientZipCode}` : null,
          dateDepart,
          statut,
          trackingData: { significantEvent: parcel.significantEvent } as any,
        },
      });
      created++;
    }
  }

  const expeditions = await prisma.chronopostExpedition.findMany({
    orderBy: { dateDepart: 'desc' },
  });

  apiResponse.success(res, {
    message: `Synchronisé : ${created} nouveau(x), ${updated} mis à jour`,
    total: result.parcels.length,
    created,
    updated,
    expeditions,
  });
}

export async function updateExpedition(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { produitNom, dateRetourPrevu, dateRetourReel, numeroColisRetour, statut, notes, clientNom } = req.body;

  const exp = await prisma.chronopostExpedition.findUnique({ where: { id } });
  if (!exp) { apiResponse.notFound(res, 'Expédition non trouvée'); return; }

  const updated = await prisma.chronopostExpedition.update({
    where: { id },
    data: {
      ...(produitNom !== undefined && { produitNom }),
      ...(clientNom !== undefined && { clientNom }),
      ...(dateRetourPrevu !== undefined && { dateRetourPrevu: dateRetourPrevu ? new Date(dateRetourPrevu) : null }),
      ...(dateRetourReel !== undefined && { dateRetourReel: dateRetourReel ? new Date(dateRetourReel) : null }),
      ...(numeroColisRetour !== undefined && { numeroColisRetour }),
      ...(statut !== undefined && { statut: statut as ChronopostStatut }),
      ...(notes !== undefined && { notes }),
    },
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

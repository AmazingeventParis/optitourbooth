import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { trackParcel, inferStatutFromTracking } from '../services/chronopost.service.js';
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

export async function createExpedition(req: Request, res: Response): Promise<void> {
  const { numeroColis, produitNom, dateRetourPrevu, notes } = req.body;
  if (!numeroColis) { apiResponse.badRequest(res, 'numeroColis requis'); return; }

  const existing = await prisma.chronopostExpedition.findUnique({ where: { numeroColis } });
  if (existing) { apiResponse.badRequest(res, 'Ce numéro de colis existe déjà'); return; }

  let trackingData: any = null;
  let clientNom = 'Inconnu';
  let clientAdresse: string | null = null;
  let clientVille: string | null = null;
  let dateDepart: Date | null = null;
  let dateLivraisonReelle: Date | null = null;
  let statut: ChronopostStatut = 'en_preparation';

  try {
    const result = await trackParcel(numeroColis);
    trackingData = result;
    if (result.recipientName) clientNom = result.recipientName;
    if (result.recipientAddress) clientAdresse = result.recipientAddress;
    if (result.recipientCity) clientVille = result.recipientCity;
    if (result.events.length > 0) {
      const firstEvent = result.events[0]!;
      if (firstEvent.date) dateDepart = new Date(firstEvent.date);
    }
    if (result.deliveryDate) dateLivraisonReelle = new Date(result.deliveryDate);
    statut = inferStatutFromTracking(result) as ChronopostStatut;
  } catch (e) {
    console.error('[Chronopost] Erreur tracking:', e);
  }

  const expedition = await prisma.chronopostExpedition.create({
    data: {
      numeroColis,
      clientNom,
      clientAdresse,
      clientVille,
      produitNom: produitNom || null,
      dateRetourPrevu: dateRetourPrevu ? new Date(dateRetourPrevu) : null,
      dateDepart,
      dateLivraisonReelle,
      notes: notes || null,
      statut,
      trackingData,
    },
  });

  apiResponse.created(res, expedition);
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

export async function syncExpedition(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const exp = await prisma.chronopostExpedition.findUnique({ where: { id } });
  if (!exp) { apiResponse.notFound(res, 'Expédition non trouvée'); return; }

  const result = await trackParcel(exp.numeroColis);
  const statut = inferStatutFromTracking(result) as ChronopostStatut;

  let dateDepart = exp.dateDepart;
  let dateLivraisonReelle = exp.dateLivraisonReelle;
  let clientNom = exp.clientNom;
  let clientAdresse = exp.clientAdresse;
  let clientVille = exp.clientVille;

  if (result.recipientName && result.recipientName !== 'Inconnu') clientNom = result.recipientName;
  if (result.recipientAddress) clientAdresse = result.recipientAddress;
  if (result.recipientCity) clientVille = result.recipientCity;
  if (!dateDepart && result.events.length > 0 && result.events[0]?.date) {
    dateDepart = new Date(result.events[0].date);
  }
  if (result.deliveryDate) dateLivraisonReelle = new Date(result.deliveryDate);

  const updated = await prisma.chronopostExpedition.update({
    where: { id },
    data: { trackingData: result as any, statut, dateDepart, dateLivraisonReelle, clientNom, clientAdresse, clientVille },
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

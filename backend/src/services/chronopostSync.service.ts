import { prisma } from '../config/database.js';
import { fetchAllParcels } from './chronotraceApi.service.js';
import { trackParcel, inferStatutFromSignificantEvent } from './chronopost.service.js';
import { ChronopostStatut } from '@prisma/client';

export async function syncChronopostAuto(): Promise<void> {
  let sessionConfigured = false;
  try {
    const session = await prisma.chronotraceSession.findUnique({ where: { id: 'singleton' } });
    sessionConfigured = !!session;
  } catch {
    sessionConfigured = false;
  }

  if (sessionConfigured) {
    await syncViaChronotrace();
  } else {
    await syncViaTrackingApi();
  }
}

async function syncViaChronotrace(): Promise<void> {
  console.log('[Chronopost CRON] Syncing via Chronotrace REST API...');
  let created = 0;
  let updated = 0;
  let errors = 0;

  try {
    const parcels = await fetchAllParcels();

    for (const p of parcels) {
      try {
        const existing = await prisma.chronopostExpedition.findUnique({
          where: { numeroColis: p.numeroColis },
        });

        if (!existing) {
          await prisma.chronopostExpedition.create({
            data: {
              numeroColis: p.numeroColis,
              clientNom: p.clientNom,
              clientVille: p.clientVille || null,
              clientAdresse: p.clientAdresse || null,
              dateDepart: p.dateDepart,
              dateLivraisonReelle: p.dateLivraisonReelle,
              statut: p.statut,
            },
          });
          created++;
        } else {
          const newStatut = existing.statut === 'rentre' ? 'rentre' : p.statut;
          await prisma.chronopostExpedition.update({
            where: { id: existing.id },
            data: {
              statut: newStatut,
              clientNom: p.clientNom || existing.clientNom,
              clientVille: p.clientVille || existing.clientVille,
              ...(p.dateDepart && !existing.dateDepart && { dateDepart: p.dateDepart }),
              ...(p.dateLivraisonReelle && !existing.dateLivraisonReelle && { dateLivraisonReelle: p.dateLivraisonReelle }),
            },
          });
          updated++;
        }
      } catch (err) {
        console.error(`[Chronopost CRON] Error on ${p.numeroColis}:`, err);
        errors++;
      }
    }

    console.log(`[Chronopost CRON] Done — ${created} new, ${updated} updated${errors ? `, ${errors} errors` : ''}`);
  } catch (err: any) {
    if (err.message?.includes('session') || err.message?.includes('401') || err.message?.includes('403')) {
      console.warn('[Chronopost CRON] Session expired — cookies need refresh. Falling back to SOAP.');
    } else {
      console.error('[Chronopost CRON] Chronotrace error:', err.message);
    }
    await syncViaTrackingApi();
  }
}

async function syncViaTrackingApi(): Promise<void> {
  const parcels = await prisma.chronopostExpedition.findMany({
    where: { statut: { notIn: ['rentre'] } },
  });

  if (parcels.length === 0) {
    console.log('[Chronopost CRON] No active parcels to refresh via SOAP');
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const parcel of parcels) {
    try {
      const result = await trackParcel(parcel.numeroColis);
      if (result.errorCode !== '0' && result.errorCode !== '000') continue;

      const lastEvent = result.events[result.events.length - 1];
      const statut = inferStatutFromSignificantEvent(
        lastEvent ? { code: lastEvent.code, eventDate: lastEvent.date, eventLabel: lastEvent.libelle } : undefined,
      ) as ChronopostStatut;

      const sortedDates = result.events.map((e) => e.date).filter(Boolean).sort();
      const dateDepart = sortedDates[0] ? new Date(sortedDates[0]) : parcel.dateDepart;

      await prisma.chronopostExpedition.update({
        where: { id: parcel.id },
        data: {
          trackingData: result as any,
          statut,
          clientNom: result.recipientName || parcel.clientNom,
          clientVille: result.recipientCity || parcel.clientVille,
          dateDepart: dateDepart || parcel.dateDepart,
        },
      });
      updated++;
    } catch {
      errors++;
    }
  }

  console.log(`[Chronopost CRON] SOAP: ${updated}/${parcels.length} updated${errors ? ` (${errors} errors)` : ''}`);
}

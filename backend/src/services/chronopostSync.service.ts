import { prisma } from '../config/database.js';
import { searchByAccount, inferStatutFromSignificantEvent } from './chronopost.service.js';
import { ChronopostStatut } from '@prisma/client';

export async function syncChronopostAuto(): Promise<void> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
    const toChronoDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '');

    const result = await searchByAccount(toChronoDate(start), toChronoDate(end));

    if (result.errorCode !== '0' && result.errorCode !== '000') {
      console.error(`[Chronopost CRON] Erreur API (${result.errorCode}): ${result.errorMessage}`);
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

    console.log(`[Chronopost CRON] Sync OK — ${result.parcels.length} colis, ${created} nouveaux, ${updated} mis à jour`);
  } catch (error) {
    console.error('[Chronopost CRON] Erreur sync:', error);
  }
}

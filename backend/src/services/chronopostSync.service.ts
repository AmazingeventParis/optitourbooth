import { prisma } from '../config/database.js';
import { trackParcel, inferStatutFromSignificantEvent } from './chronopost.service.js';
import { ChronopostStatut } from '@prisma/client';

export async function syncChronopostAuto(): Promise<void> {
  try {
    const parcels = await prisma.chronopostExpedition.findMany({
      where: { statut: { not: 'rentre' } },
    });

    if (parcels.length === 0) {
      console.log('[Chronopost CRON] No active parcels to refresh');
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

        const sortedDates = result.events.map(e => e.date).filter(Boolean).sort();
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

    console.log(`[Chronopost CRON] Refreshed ${updated}/${parcels.length} parcels${errors ? ` (${errors} errors)` : ''}`);
  } catch (error) {
    console.error('[Chronopost CRON] Error:', error);
  }
}

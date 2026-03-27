import { prisma } from '../config/database.js';

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + (m || 0);
}

function formatTimeFromDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isTimeInRange(time: string, debut: string, fin: string): boolean {
  const t = timeToMinutes(time);
  const d = timeToMinutes(debut);
  const f = timeToMinutes(fin);
  if (d <= f) {
    return t >= d && t <= f;
  } else {
    return t >= d || t <= f;
  }
}

/**
 * Sync HF billing entry for a single point.
 * Creates, updates, or deletes the entry based on the chauffeur's config.
 */
export async function syncPointBilling(pointId: string): Promise<void> {
  const point = await prisma.point.findUnique({
    where: { id: pointId },
    include: {
      client: { select: { nom: true } },
      tournee: { select: { id: true, chauffeurId: true, date: true } },
    },
  });
  if (!point || !point.tournee) return;

  const { chauffeurId, date } = point.tournee;

  const config = await prisma.billingConfig.findUnique({
    where: { userId: chauffeurId },
  });

  // Determine point time
  const timeStr = point.creneauDebut
    ? formatTimeFromDate(point.creneauDebut)
    : point.heureArriveeReelle
      ? formatTimeFromDate(point.heureArriveeReelle)
      : null;

  // --- HF billing ---
  const isHF = config && config.tarifPointHorsForfait > 0 && (
    config.isIndependent
    || (timeStr && config.horsForfaitDebut && config.horsForfaitFin && isTimeInRange(timeStr, config.horsForfaitDebut, config.horsForfaitFin))
  );

  const existingHf = await prisma.billingEntry.findFirst({
    where: { pointId, type: 'point_hors_forfait' },
  });

  if (isHF && config) {
    const label = config.isIndependent
      ? `Point indép. - ${point.client.nom}${timeStr ? ` (${timeStr})` : ''}`
      : `Point HF - ${point.client.nom} (${timeStr})`;

    if (existingHf) {
      // Update userId if chauffeur changed
      await prisma.billingEntry.update({
        where: { id: existingHf.id },
        data: {
          userId: chauffeurId,
          tourneeId: point.tournee.id,
          date,
          label,
          unitPrice: config.tarifPointHorsForfait,
          totalPrice: config.tarifPointHorsForfait,
        },
      });
    } else {
      await prisma.billingEntry.create({
        data: {
          userId: chauffeurId,
          tourneeId: point.tournee.id,
          pointId,
          date,
          type: 'point_hors_forfait',
          label,
          quantity: 1,
          unitPrice: config.tarifPointHorsForfait,
          totalPrice: config.tarifPointHorsForfait,
          metadata: { time: timeStr || 'N/A', clientName: point.client.nom, source: 'auto' },
        },
      });
    }
  } else if (existingHf) {
    // Point no longer HF (config removed or time changed) → delete
    await prisma.billingEntry.delete({ where: { id: existingHf.id } });
  }

  // --- Recovery billing ---
  if (!config || !timeStr) return;

  const recupRanges: Array<{ debut: string; fin: string }> = [];
  if (config.recuperationDebut && config.recuperationFin) {
    recupRanges.push({ debut: config.recuperationDebut, fin: config.recuperationFin });
  }
  if ((config as any).recuperationDebut2 && (config as any).recuperationFin2) {
    recupRanges.push({ debut: (config as any).recuperationDebut2, fin: (config as any).recuperationFin2 });
  }

  const pointMinutes = timeToMinutes(timeStr);
  let recupMinutes = 0;
  let recupRange = '';

  for (const range of recupRanges) {
    const rDebut = timeToMinutes(range.debut);
    const rFin = timeToMinutes(range.fin);
    if (pointMinutes < rDebut || pointMinutes > rFin) continue;

    const midpoint = (rDebut + rFin) / 2;
    if (midpoint < 720) {
      recupMinutes = rFin - pointMinutes;
    } else {
      recupMinutes = pointMinutes - rDebut;
    }
    recupRange = `${range.debut} → ${range.fin}`;
    break;
  }

  const existingRecup = await prisma.billingEntry.findFirst({
    where: { pointId, type: 'recuperation' },
  });

  if (recupMinutes > 0) {
    const recupHours = Math.round(recupMinutes / 30) * 0.5;
    const recupLabel = `Récup. - ${point.client.nom} (${timeStr}, plage ${recupRange})`;

    if (existingRecup) {
      await prisma.billingEntry.update({
        where: { id: existingRecup.id },
        data: {
          userId: chauffeurId,
          tourneeId: point.tournee.id,
          date,
          label: recupLabel,
          quantity: recupHours,
        },
      });
    } else {
      await prisma.billingEntry.create({
        data: {
          userId: chauffeurId,
          tourneeId: point.tournee.id,
          pointId,
          date,
          type: 'recuperation',
          label: recupLabel,
          quantity: recupHours,
          unitPrice: 0,
          totalPrice: 0,
          metadata: { time: timeStr, recupMinutes, recupRange, clientName: point.client.nom, source: 'auto' },
        },
      });
    }
  } else if (existingRecup) {
    await prisma.billingEntry.delete({ where: { id: existingRecup.id } });
  }
}

/**
 * Sync billing for all points in a tournee (used when chauffeur changes).
 */
export async function syncTourneeBilling(tourneeId: string): Promise<void> {
  const points = await prisma.point.findMany({
    where: { tourneeId },
    select: { id: true },
  });
  for (const point of points) {
    await syncPointBilling(point.id);
  }
}

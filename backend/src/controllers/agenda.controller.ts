import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Mapping produit.nom → MachineType (les noms correspondent 1:1)
 */
const PRODUIT_TO_MACHINE_TYPE: Record<string, string> = {
  Vegas: 'Vegas',
  Smakk: 'Smakk',
  Ring: 'Ring',
  Miroir: 'Miroir',
  Playbox: 'Playbox',
  Aircam: 'Aircam',
  Spinner: 'Spinner',
};

interface AllocationBlock {
  id: string; // preparation id
  machineId: string;
  machineType: string;
  machineNumero: string;
  machineCouleur: string;
  client: string;
  status: string;
  dateStart: string;     // ISO date
  timeStart: string;     // HH:MM
  dateEnd: string;       // ISO date
  timeEnd: string;       // HH:MM
  preparationId: string;
  deliveryPointId: string | null;
  pickupPointId: string | null;
}

/**
 * Format a time field (Time or DateTime) to HH:MM
 */
function formatTime(t: Date | string | null): string | null {
  if (!t) return null;
  if (t instanceof Date) {
    return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof t === 'string' && t.includes('T')) {
    const d = new Date(t);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof t === 'string' && t.includes(':')) {
    return t.substring(0, 5);
  }
  return null;
}

function formatDateStr(d: Date): string {
  return d.toISOString().substring(0, 10);
}

/**
 * GET /api/agenda/allocations?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Returns machine allocation blocks with immobilization windows computed from points
 */
export const getAllocations = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

  if (!dateFrom || !dateTo) {
    return apiResponse.badRequest(res, 'dateFrom et dateTo requis');
  }

  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T23:59:59Z');

  // 1. Get all active preparations in date range (non-archived, non-disponible)
  const preparations = await prisma.preparation.findMany({
    where: {
      dateEvenement: { gte: from, lte: to },
      statut: { notIn: ['archivee', 'disponible'] },
    },
    include: {
      machine: true,
    },
    orderBy: [{ machineId: 'asc' }, { dateEvenement: 'asc' }],
  });

  // 2. Get all points in the same date range with their products
  const tournees = await prisma.tournee.findMany({
    where: {
      date: { gte: from, lte: to },
    },
    include: {
      points: {
        include: {
          client: { select: { id: true, nom: true } },
          produits: {
            include: {
              produit: { select: { id: true, nom: true } },
            },
          },
        },
      },
    },
  });

  // 3. Build a lookup: clientName (lowercase) + date → points
  const pointsLookup = new Map<string, Array<{
    id: string;
    type: string;
    date: string;
    creneauDebut: string | null;
    creneauFin: string | null;
    clientName: string;
    produitNom: string | null;
  }>>();

  for (const tournee of tournees) {
    const dateStr = formatDateStr(tournee.date);
    for (const point of tournee.points) {
      const clientKey = (point.client?.nom || '').toLowerCase().trim();
      const produitNom = point.produits?.[0]?.produit?.nom || null;

      const entry = {
        id: point.id,
        type: point.type,
        date: dateStr,
        creneauDebut: formatTime(point.creneauDebut),
        creneauFin: formatTime(point.creneauFin),
        clientName: clientKey,
        produitNom,
      };

      // Index by client name (for fuzzy matching)
      if (!pointsLookup.has(clientKey)) pointsLookup.set(clientKey, []);
      pointsLookup.get(clientKey)!.push(entry);
    }
  }

  // Also look at nearby dates (machine might be delivered before or picked up after the prep dateEvenement)
  const extendedFrom = new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000);
  const extendedTo = new Date(to.getTime() + 7 * 24 * 60 * 60 * 1000);
  const extendedTournees = await prisma.tournee.findMany({
    where: {
      date: { gte: extendedFrom, lte: extendedTo },
      id: { notIn: tournees.map(t => t.id) },
    },
    include: {
      points: {
        include: {
          client: { select: { id: true, nom: true } },
          produits: {
            include: {
              produit: { select: { id: true, nom: true } },
            },
          },
        },
      },
    },
  });

  for (const tournee of extendedTournees) {
    const dateStr = formatDateStr(tournee.date);
    for (const point of tournee.points) {
      const clientKey = (point.client?.nom || '').toLowerCase().trim();
      const produitNom = point.produits?.[0]?.produit?.nom || null;

      const entry = {
        id: point.id,
        type: point.type,
        date: dateStr,
        creneauDebut: formatTime(point.creneauDebut),
        creneauFin: formatTime(point.creneauFin),
        clientName: clientKey,
        produitNom,
      };

      if (!pointsLookup.has(clientKey)) pointsLookup.set(clientKey, []);
      pointsLookup.get(clientKey)!.push(entry);
    }
  }

  // 4. For each preparation, find delivery + pickup points to compute immobilization window
  const blocks: AllocationBlock[] = [];

  for (const prep of preparations) {
    const prepClient = prep.client.toLowerCase().trim();
    const prepDateStr = formatDateStr(prep.dateEvenement);
    const machineType = prep.machine.type;

    // Find matching points for this client
    // Try exact client name match first, then partial
    let clientPoints = pointsLookup.get(prepClient) || [];
    if (clientPoints.length === 0) {
      // Try partial match (client name in prep might be concatenated like "babychou+ flocage")
      const firstWord = prepClient.split(/[+\s]/)[0]?.trim();
      if (firstWord && firstWord.length > 2) {
        for (const [key, pts] of pointsLookup) {
          if (key.includes(firstWord) || firstWord.includes(key)) {
            clientPoints = [...clientPoints, ...pts];
          }
        }
      }
    }

    // Filter to relevant product type (matching machine type)
    const relevantPoints = clientPoints.filter(p => {
      // Match by product name or no product (ramassage often has no product)
      return !p.produitNom || PRODUIT_TO_MACHINE_TYPE[p.produitNom] === machineType;
    });

    // Find delivery (livraison) point closest to/before event date
    const deliveryPoints = relevantPoints
      .filter(p => p.type === 'livraison' || p.type === 'livraison_ramassage')
      .sort((a, b) => {
        // Prefer points on or before event date
        const da = Math.abs(new Date(a.date).getTime() - prep.dateEvenement.getTime());
        const db = Math.abs(new Date(b.date).getTime() - prep.dateEvenement.getTime());
        return da - db;
      });

    // Find pickup (ramassage) point closest to/after event date
    const pickupPoints = relevantPoints
      .filter(p => p.type === 'ramassage' || p.type === 'livraison_ramassage')
      .filter(p => p.date >= prepDateStr)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const delivery = deliveryPoints[0] || null;
    const pickup = pickupPoints[0] || null;

    // Compute immobilization window
    const dateStart = delivery?.date || prepDateStr;
    const timeStart = delivery?.creneauDebut || '00:00';
    const dateEnd = pickup?.date || prepDateStr;
    const timeEnd = pickup?.creneauFin || '23:59';

    blocks.push({
      id: prep.id,
      machineId: prep.machineId,
      machineType: prep.machine.type,
      machineNumero: prep.machine.numero,
      machineCouleur: prep.machine.couleur || '#6B7280',
      client: prep.client,
      status: prep.statut,
      dateStart,
      timeStart,
      dateEnd,
      timeEnd,
      preparationId: prep.id,
      deliveryPointId: delivery?.id || null,
      pickupPointId: pickup?.id || null,
    });
  }

  // 5. Include hors_service machines as permanent blocks
  const horsServicePreps = await prisma.preparation.findMany({
    where: { statut: 'hors_service' },
    include: { machine: true },
  });

  for (const prep of horsServicePreps) {
    blocks.push({
      id: prep.id,
      machineId: prep.machineId,
      machineType: prep.machine.type,
      machineNumero: prep.machine.numero,
      machineCouleur: prep.machine.couleur || '#6B7280',
      client: 'HORS SERVICE',
      status: 'hors_service',
      dateStart: dateFrom,
      timeStart: '00:00',
      dateEnd: dateTo,
      timeEnd: '23:59',
      preparationId: prep.id,
      deliveryPointId: null,
      pickupPointId: null,
    });
  }

  return apiResponse.success(res, blocks);
});

/**
 * GET /api/agenda/stock?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Returns daily stock availability per machine type
 */
export const getStock = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

  if (!dateFrom || !dateTo) {
    return apiResponse.badRequest(res, 'dateFrom et dateTo requis');
  }

  // Get total machines per type
  const machines = await prisma.machine.findMany({
    where: { actif: true },
    select: { id: true, type: true },
  });

  const totalByType: Record<string, number> = {};
  for (const m of machines) {
    totalByType[m.type] = (totalByType[m.type] || 0) + 1;
  }

  // Count hors_service per type
  const horsService = await prisma.preparation.findMany({
    where: { statut: 'hors_service' },
    include: { machine: { select: { type: true } } },
  });

  const hsCountByType: Record<string, number> = {};
  for (const hs of horsService) {
    hsCountByType[hs.machine.type] = (hsCountByType[hs.machine.type] || 0) + 1;
  }

  // Get allocations to compute per-day availability
  // Re-use getAllocations logic by calling internal
  const allocRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/agenda/allocations?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
    headers: { Authorization: req.headers.authorization || '' },
  }).catch(() => null);

  // Fallback: compute directly
  const allPreps = await prisma.preparation.findMany({
    where: {
      dateEvenement: {
        gte: new Date(dateFrom + 'T00:00:00Z'),
        lte: new Date(dateTo + 'T23:59:59Z'),
      },
      statut: { notIn: ['archivee', 'disponible'] },
    },
    include: { machine: { select: { type: true } } },
  });

  // Simple per-day count: how many machines of each type are occupied on each day
  const days: Record<string, Record<string, number>> = {};
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().substring(0, 10);
    days[ds] = {};
    for (const type of Object.keys(totalByType)) {
      days[ds]![type] = 0;
    }
  }

  for (const prep of allPreps) {
    const ds = prep.dateEvenement.toISOString().substring(0, 10);
    if (days[ds]) {
      days[ds]![prep.machine.type] = (days[ds]![prep.machine.type] || 0) + 1;
    }
  }

  // Build result
  const stock = Object.entries(days).map(([date, occupied]) => {
    const availability: Record<string, { total: number; occupied: number; horsService: number; available: number }> = {};
    for (const [type, total] of Object.entries(totalByType)) {
      const hs = hsCountByType[type] || 0;
      const occ = occupied[type] || 0;
      availability[type] = {
        total,
        occupied: occ + hs,
        horsService: hs,
        available: total - occ - hs,
      };
    }
    return { date, availability };
  });

  return apiResponse.success(res, { totalByType, horsServiceByType: hsCountByType, days: stock });
});

/**
 * GET /api/agenda/machines
 * Returns all machines grouped by type for the agenda sidebar/legend
 */
export const getMachines = asyncHandler(async (_req: Request, res: Response) => {
  const machines = await prisma.machine.findMany({
    where: { actif: true },
    orderBy: [{ type: 'asc' }, { numero: 'asc' }],
    select: {
      id: true,
      type: true,
      numero: true,
      couleur: true,
      aDefaut: true,
      defaut: true,
    },
  });

  // Group by type
  const grouped: Record<string, typeof machines> = {};
  for (const m of machines) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type]!.push(m);
  }

  return apiResponse.success(res, grouped);
});

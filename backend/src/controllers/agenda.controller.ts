import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

interface AllocationBlock {
  id: string;
  client: string;
  produit: string;
  produitCouleur: string;
  dateStart: string;
  timeStart: string;
  dateEnd: string;
  timeEnd: string;
  deliveryPointId: string;
  pickupPointId: string | null;
  machineNumero: string | null;  // from preparation if linked
  machineType: string | null;
  status: 'immobilisee' | 'livree' | 'recuperee';
}

function formatTimeField(t: Date | string | null): string | null {
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

function fmtDate(d: Date): string {
  return d.toISOString().substring(0, 10);
}

/**
 * GET /api/agenda/allocations?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * Builds immobilization blocks from points:
 * - Find all delivery points (livraison) with products in the range
 * - Match each delivery with its pickup (ramassage) by client name
 * - Block = from delivery date+creneauDebut to pickup date+creneauFin
 * - If linked to a preparation, include machine number
 */
export const getAllocations = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
  if (!dateFrom || !dateTo) return apiResponse.badRequest(res, 'dateFrom et dateTo requis');

  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T23:59:59Z');

  // Extended range to catch pickups that happen after dateTo or deliveries before dateFrom
  const extFrom = new Date(from.getTime() - 14 * 24 * 3600000);
  const extTo = new Date(to.getTime() + 14 * 24 * 3600000);

  // Get all points with products in extended range
  const points = await prisma.point.findMany({
    where: {
      tournee: { date: { gte: extFrom, lte: extTo } },
    },
    include: {
      tournee: { select: { date: true } },
      client: { select: { id: true, nom: true } },
      produits: { include: { produit: { select: { id: true, nom: true, couleur: true } } } },
    },
    orderBy: [{ tournee: { date: 'asc' } }, { creneauDebut: 'asc' }],
  });

  // Group points by client + product type
  // A "livraison" starts the immobilization, a "ramassage" ends it
  const deliveries: typeof points = [];
  const pickups: typeof points = [];

  for (const pt of points) {
    if (pt.type === 'livraison' || pt.type === 'livraison_ramassage') deliveries.push(pt);
    if (pt.type === 'ramassage' || pt.type === 'livraison_ramassage') pickups.push(pt);
  }

  // Get preparations to link machine numbers
  const preparations = await prisma.preparation.findMany({
    where: {
      dateEvenement: { gte: extFrom, lte: extTo },
    },
    include: { machine: { select: { id: true, type: true, numero: true, couleur: true } } },
  });

  // Index preparations by client (lowercase) + date for matching
  const prepIndex = new Map<string, typeof preparations>();
  for (const prep of preparations) {
    const key = `${prep.client.toLowerCase().trim()}|${fmtDate(prep.dateEvenement)}`;
    if (!prepIndex.has(key)) prepIndex.set(key, []);
    prepIndex.get(key)!.push(prep);
  }

  // Match deliveries to pickups
  const blocks: AllocationBlock[] = [];
  const usedPickups = new Set<string>();

  for (const delivery of deliveries) {
    const deliveryDate = fmtDate(delivery.tournee.date);
    const clientName = delivery.client?.nom || '';
    const clientLower = clientName.toLowerCase().trim();
    const produit = delivery.produits?.[0]?.produit;
    if (!produit) continue; // skip points without product

    // Find matching pickup: same client (or partial match), same or later date
    const matchingPickup = pickups.find(p => {
      if (usedPickups.has(p.id)) return false;
      const pickupDate = fmtDate(p.tournee.date);
      if (pickupDate < deliveryDate) return false;

      const pickupClient = (p.client?.nom || '').toLowerCase().trim();
      // Exact match or partial (first word)
      const firstWordDelivery = clientLower.split(/[+\s]/)[0]?.trim();
      const firstWordPickup = pickupClient.split(/[+\s]/)[0]?.trim();
      return pickupClient === clientLower
        || (firstWordDelivery && firstWordDelivery.length > 2 && pickupClient.includes(firstWordDelivery))
        || (firstWordPickup && firstWordPickup.length > 2 && clientLower.includes(firstWordPickup));
    });

    if (matchingPickup) usedPickups.add(matchingPickup.id);

    const dateStart = deliveryDate;
    const timeStart = formatTimeField(delivery.creneauDebut) || '00:00';
    const dateEnd = matchingPickup ? fmtDate(matchingPickup.tournee.date) : deliveryDate;
    const timeEnd = matchingPickup ? (formatTimeField(matchingPickup.creneauFin) || '23:59') : '23:59';

    // Determine status
    let status: AllocationBlock['status'] = 'immobilisee';
    if (delivery.statut === 'termine' && matchingPickup?.statut === 'termine') status = 'recuperee';
    else if (delivery.statut === 'termine') status = 'livree';

    // Check if overlaps with our display range
    if (dateEnd < dateFrom && dateStart < dateFrom) continue;
    if (dateStart > dateTo) continue;

    // Try to find linked preparation (machine assignment)
    let machineNumero: string | null = null;
    let machineType: string | null = null;

    // Match by client name + date
    const prepKey = `${clientLower}|${deliveryDate}`;
    const linkedPreps = prepIndex.get(prepKey);
    if (linkedPreps && linkedPreps.length > 0) {
      // Find prep matching the product type
      const matchedPrep = linkedPreps.find(p => p.machine.type === produit.nom) || linkedPreps[0];
      if (matchedPrep) {
        machineNumero = matchedPrep.machine.numero;
        machineType = matchedPrep.machine.type;
      }
    }
    // Also try partial client name match
    if (!machineNumero) {
      const firstWord = clientLower.split(/[+\s]/)[0]?.trim();
      if (firstWord && firstWord.length > 2) {
        for (const [key, preps] of prepIndex) {
          if (key.includes(firstWord)) {
            const p = preps.find(p => p.machine.type === produit.nom) || preps[0];
            if (p) { machineNumero = p.machine.numero; machineType = p.machine.type; break; }
          }
        }
      }
    }

    blocks.push({
      id: delivery.id,
      client: clientName,
      produit: produit.nom,
      produitCouleur: produit.couleur || '#6B7280',
      dateStart,
      timeStart,
      dateEnd,
      timeEnd,
      deliveryPointId: delivery.id,
      pickupPointId: matchingPickup?.id || null,
      machineNumero,
      machineType,
      status,
    });
  }

  // Add hors_service machines as permanent blocks
  const hsPreps = await prisma.preparation.findMany({
    where: { statut: 'hors_service' },
    include: { machine: { select: { type: true, numero: true, couleur: true } } },
  });
  for (const hs of hsPreps) {
    blocks.push({
      id: `hs-${hs.id}`,
      client: 'HORS SERVICE',
      produit: hs.machine.type,
      produitCouleur: hs.machine.couleur || '#EF4444',
      dateStart: dateFrom,
      timeStart: '00:00',
      dateEnd: dateTo,
      timeEnd: '23:59',
      deliveryPointId: '',
      pickupPointId: null,
      machineNumero: hs.machine.numero,
      machineType: hs.machine.type,
      status: 'immobilisee',
    });
  }

  return apiResponse.success(res, blocks);
});

/**
 * GET /api/agenda/stock?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 */
export const getStock = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
  if (!dateFrom || !dateTo) return apiResponse.badRequest(res, 'dateFrom et dateTo requis');

  // Total machines per type
  const machines = await prisma.machine.findMany({
    where: { actif: true },
    select: { type: true },
  });
  const totalByType: Record<string, number> = {};
  for (const m of machines) totalByType[m.type] = (totalByType[m.type] || 0) + 1;

  // HS count
  const hsPreps = await prisma.preparation.findMany({
    where: { statut: 'hors_service' },
    include: { machine: { select: { type: true } } },
  });
  const hsByType: Record<string, number> = {};
  for (const hs of hsPreps) hsByType[hs.machine.type] = (hsByType[hs.machine.type] || 0) + 1;

  // Count occupied per day from delivery points with products
  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T23:59:59Z');

  // Get all allocations to compute occupancy
  // Simplified: count points of type livraison per day per product type
  const deliveryPoints = await prisma.point.findMany({
    where: {
      tournee: { date: { gte: from, lte: to } },
      type: { in: ['livraison', 'livraison_ramassage'] },
    },
    include: {
      tournee: { select: { date: true } },
      produits: { include: { produit: { select: { nom: true } } } },
    },
  });

  // For a more accurate count, we need to know which machines are actually out
  // A machine delivered on day X is occupied until its pickup day
  // For simplicity, count deliveries per day as a proxy
  const days: Record<string, Record<string, number>> = {};
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().substring(0, 10);
    days[ds] = {};
    for (const type of Object.keys(totalByType)) days[ds]![type] = 0;
  }

  // Use allocations endpoint logic to count properly
  // Each delivery-pickup pair occupies the machine for the full range
  for (const pt of deliveryPoints) {
    const prodName = pt.produits?.[0]?.produit?.nom;
    if (!prodName) continue;
    const deliveryDate = fmtDate(pt.tournee.date);
    // Mark this date and following days until we find pickup
    // For stock, just mark the delivery date for now
    if (days[deliveryDate] && days[deliveryDate]![prodName] !== undefined) {
      days[deliveryDate]![prodName]!++;
    }
  }

  const stock = Object.entries(days).map(([date, occupied]) => {
    const availability: Record<string, { total: number; occupied: number; horsService: number; available: number }> = {};
    for (const [type, total] of Object.entries(totalByType)) {
      const hs = hsByType[type] || 0;
      const occ = occupied[type] || 0;
      availability[type] = { total, occupied: occ + hs, horsService: hs, available: Math.max(0, total - occ - hs) };
    }
    return { date, availability };
  });

  return apiResponse.success(res, { totalByType, horsServiceByType: hsByType, days: stock });
});

/**
 * GET /api/agenda/machines
 */
export const getMachines = asyncHandler(async (_req: Request, res: Response) => {
  const machines = await prisma.machine.findMany({
    where: { actif: true },
    orderBy: [{ type: 'asc' }, { numero: 'asc' }],
    select: { id: true, type: true, numero: true, couleur: true, aDefaut: true, defaut: true },
  });

  const grouped: Record<string, typeof machines> = {};
  for (const m of machines) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type]!.push(m);
  }

  return apiResponse.success(res, grouped);
});

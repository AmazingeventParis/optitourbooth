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
  machineNumero: string | null;
  machineType: string | null;
  status: 'planifie' | 'immobilisee' | 'livree' | 'recuperee';
  source: 'tournee' | 'pending' | 'preparation';
}

function fmtTime(t: Date | string | null): string | null {
  if (!t) return null;
  if (t instanceof Date) return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof t === 'string' && t.includes('T')) { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }
  if (typeof t === 'string' && t.includes(':')) return t.substring(0, 5);
  return null;
}

function fmtDate(d: Date): string { return d.toISOString().substring(0, 10); }

function clientFirstWord(name: string): string {
  return name.toLowerCase().trim().split(/[+\s]/)[0]?.trim() || '';
}

/**
 * GET /api/agenda/allocations?dateFrom=&dateTo=
 */
export const getAllocations = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
  if (!dateFrom || !dateTo) return apiResponse.badRequest(res, 'dateFrom et dateTo requis');

  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T23:59:59Z');
  const extFrom = new Date(from.getTime() - 14 * 86400000);
  const extTo = new Date(to.getTime() + 14 * 86400000);

  // ========== SOURCE 1: Points de tournée ==========
  const allPoints = await prisma.point.findMany({
    where: { tournee: { date: { gte: extFrom, lte: extTo } } },
    include: {
      tournee: { select: { date: true } },
      client: { select: { id: true, nom: true } },
      produits: { include: { produit: { select: { id: true, nom: true, couleur: true } } } },
    },
    orderBy: [{ tournee: { date: 'asc' } }, { creneauDebut: 'asc' }],
  });

  const deliveries = allPoints.filter(p => p.type === 'livraison' || p.type === 'livraison_ramassage');
  const pickups = allPoints.filter(p => p.type === 'ramassage' || p.type === 'livraison_ramassage');

  // ========== SOURCE 2: Preparations (for machine numbers) ==========
  const preparations = await prisma.preparation.findMany({
    where: {
      dateEvenement: { gte: extFrom, lte: extTo },
      statut: { not: 'hors_service' },
      client: { not: 'HORS SERVICE' },
    },
    include: { machine: { select: { type: true, numero: true, couleur: true } } },
  });

  // Index preps by client first word + date
  const prepsByClient = new Map<string, typeof preparations>();
  for (const prep of preparations) {
    const fw = clientFirstWord(prep.client);
    if (!fw || fw.length < 2) continue;
    const key = `${fw}|${fmtDate(prep.dateEvenement)}`;
    if (!prepsByClient.has(key)) prepsByClient.set(key, []);
    prepsByClient.get(key)!.push(prep);
  }

  function findMachine(clientName: string, date: string, produitNom: string): { numero: string; type: string } | null {
    const fw = clientFirstWord(clientName);
    if (!fw || fw.length < 2) return null;
    const key = `${fw}|${date}`;
    const preps = prepsByClient.get(key);
    if (!preps) return null;
    const match = preps.find(p => p.machine.type === produitNom) || preps[0];
    return match ? { numero: match.machine.numero, type: match.machine.type } : null;
  }

  // ========== Build blocks from point pairs ==========
  const blocks: AllocationBlock[] = [];
  const usedPickups = new Set<string>();
  const usedDeliveryClients = new Set<string>(); // track which clients have point-based blocks

  for (const delivery of deliveries) {
    const dDate = fmtDate(delivery.tournee.date);
    const clientName = delivery.client?.nom || '';
    const produit = delivery.produits?.[0]?.produit;
    if (!produit) continue;

    const fw = clientFirstWord(clientName);

    // Find matching pickup
    const pickup = pickups.find(p => {
      if (usedPickups.has(p.id)) return false;
      const pDate = fmtDate(p.tournee.date);
      if (pDate < dDate) return false;
      const pfw = clientFirstWord(p.client?.nom || '');
      return (p.client?.nom || '').toLowerCase().trim() === clientName.toLowerCase().trim()
        || (fw.length > 2 && pfw.length > 2 && (pfw.includes(fw) || fw.includes(pfw)));
    });
    if (pickup) usedPickups.add(pickup.id);

    const dateStart = dDate;
    const timeStart = fmtTime(delivery.creneauDebut) || '00:00';
    const dateEnd = pickup ? fmtDate(pickup.tournee.date) : dDate;
    const timeEnd = pickup ? (fmtTime(pickup.creneauFin) || '23:59') : '23:59';

    if (dateEnd < dateFrom && dateStart < dateFrom) continue;
    if (dateStart > dateTo) continue;

    let status: AllocationBlock['status'] = 'immobilisee';
    if (delivery.statut === 'termine' && pickup?.statut === 'termine') status = 'recuperee';
    else if (delivery.statut === 'termine') status = 'livree';

    const machine = findMachine(clientName, dDate, produit.nom);
    usedDeliveryClients.add(fw + '|' + dDate);

    blocks.push({
      id: delivery.id,
      client: clientName,
      produit: produit.nom,
      produitCouleur: produit.couleur || '#6B7280',
      dateStart, timeStart, dateEnd, timeEnd,
      machineNumero: machine?.numero || null,
      machineType: machine?.type || null,
      status,
      source: 'tournee',
    });
  }

  // ========== SOURCE 3: Pending points NOT dispatched ==========
  const pendingPoints = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: from, lte: to },
      type: 'livraison',
    },
  });

  for (const pp of pendingPoints) {
    const ppDate = fmtDate(pp.date);
    const fw = clientFirstWord(pp.clientName);

    // Skip if already covered by a point-based block
    if (usedDeliveryClients.has(fw + '|' + ppDate)) continue;
    if (!pp.produitNom) continue;

    // Find matching pending pickup
    const pendingPickup = await prisma.pendingPoint.findFirst({
      where: {
        type: 'ramassage',
        date: { gte: pp.date },
        clientName: { contains: fw, mode: 'insensitive' },
      },
      orderBy: { date: 'asc' },
    });

    const dateEnd = pendingPickup ? fmtDate(pendingPickup.date) : ppDate;
    const timeEnd = pendingPickup?.creneauFin || '23:59';

    const machine = findMachine(pp.clientName, ppDate, pp.produitNom);

    // Get product color
    const produit = await prisma.produit.findFirst({ where: { nom: pp.produitNom }, select: { couleur: true } });

    blocks.push({
      id: `pp-${pp.id}`,
      client: pp.clientName,
      produit: pp.produitNom,
      produitCouleur: produit?.couleur || '#6B7280',
      dateStart: ppDate,
      timeStart: pp.creneauDebut || '00:00',
      dateEnd,
      timeEnd,
      machineNumero: machine?.numero || null,
      machineType: machine?.type || null,
      status: 'planifie',
      source: 'pending',
    });
  }

  // ========== SOURCE 4: Preparations without matching points/pending ==========
  for (const prep of preparations) {
    const prepDate = fmtDate(prep.dateEvenement);
    if (prepDate < dateFrom || prepDate > dateTo) continue;
    if (prep.statut === 'disponible') continue;

    const fw = clientFirstWord(prep.client);
    // Skip if already covered
    const alreadyCovered = blocks.some(b => {
      const bfw = clientFirstWord(b.client);
      return bfw === fw && b.dateStart <= prepDate && b.dateEnd >= prepDate;
    });
    if (alreadyCovered) continue;

    blocks.push({
      id: `prep-${prep.id}`,
      client: prep.client,
      produit: prep.machine.type,
      produitCouleur: prep.machine.couleur || '#6B7280',
      dateStart: prepDate,
      timeStart: '00:00',
      dateEnd: prepDate,
      timeEnd: '23:59',
      machineNumero: prep.machine.numero,
      machineType: prep.machine.type,
      status: prep.statut === 'archivee' ? 'recuperee' : 'immobilisee',
      source: 'preparation',
    });
  }

  // Sort by dateStart then timeStart
  blocks.sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.timeStart.localeCompare(b.timeStart));

  return apiResponse.success(res, blocks);
});

/**
 * GET /api/agenda/stock?dateFrom=&dateTo=
 */
export const getStock = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
  if (!dateFrom || !dateTo) return apiResponse.badRequest(res, 'dateFrom et dateTo requis');

  const machines = await prisma.machine.findMany({ where: { actif: true }, select: { type: true } });
  const totalByType: Record<string, number> = {};
  for (const m of machines) totalByType[m.type] = (totalByType[m.type] || 0) + 1;

  const hsPreps = await prisma.preparation.findMany({
    where: { statut: 'hors_service' },
    include: { machine: { select: { type: true } } },
  });
  const hsByType: Record<string, number> = {};
  for (const hs of hsPreps) hsByType[hs.machine.type] = (hsByType[hs.machine.type] || 0) + 1;

  // Count occupied per day from delivery points
  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T23:59:59Z');

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

  const days: Record<string, Record<string, number>> = {};
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().substring(0, 10);
    days[ds] = {};
    for (const type of Object.keys(totalByType)) days[ds]![type] = 0;
  }

  for (const pt of deliveryPoints) {
    const prodName = pt.produits?.[0]?.produit?.nom;
    if (!prodName || !days[fmtDate(pt.tournee.date)]) continue;
    days[fmtDate(pt.tournee.date)]![prodName] = (days[fmtDate(pt.tournee.date)]![prodName] || 0) + 1;
  }

  // Also count pending points not dispatched
  const pendingDeliveries = await prisma.pendingPoint.findMany({
    where: { date: { gte: from, lte: to }, type: 'livraison', produitNom: { not: null } },
  });
  for (const pp of pendingDeliveries) {
    const ds = fmtDate(pp.date);
    if (pp.produitNom && days[ds]) {
      days[ds]![pp.produitNom] = (days[ds]![pp.produitNom] || 0) + 1;
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
  for (const m of machines) { if (!grouped[m.type]) grouped[m.type] = []; grouped[m.type]!.push(m); }
  return apiResponse.success(res, grouped);
});

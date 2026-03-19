import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';

interface AllocationBlock {
  id: string;
  client: string;
  clientAdresse: string | null;
  clientVille: string | null;
  clientTelephone: string | null;
  clientContactNom: string | null;
  produit: string;
  produitCouleur: string;
  dateStart: string;
  timeStart: string;
  dateEnd: string;
  timeEnd: string;
  machineNumero: string | null;
  machineType: string | null;
  status: 'planifie' | 'immobilisee' | 'livree';
  source: 'tournee' | 'pending' | 'preparation';
  tourneeId: string | null;
  deliveryPointId: string | null;
  pickupPointId: string | null;
  notesInternes: string | null;
  preparateurNom: string | null;
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
      tournee: { select: { id: true, date: true } },
      client: { select: { id: true, nom: true, adresse: true, codePostal: true, ville: true, telephone: true, contactNom: true, contactTelephone: true } },
      produits: { include: { produit: { select: { id: true, nom: true, couleur: true } } } },
    },
    orderBy: [{ tournee: { date: 'asc' } }, { creneauDebut: 'asc' }],
  });

  const deliveries = allPoints.filter(p => p.type === 'livraison' || p.type === 'livraison_ramassage');
  const pickups = allPoints.filter(p => p.type === 'ramassage' || p.type === 'livraison_ramassage');

  // Build pending_points lookup for fallback produit info
  const allPendingPoints = await prisma.pendingPoint.findMany({
    where: { date: { gte: extFrom, lte: extTo } },
  });
  const pendingByClientDate = new Map<string, typeof allPendingPoints[0]>();
  for (const pp of allPendingPoints) {
    const fw = clientFirstWord(pp.clientName);
    const key = `${fw}|${fmtDate(pp.date)}`;
    if (!pendingByClientDate.has(key)) pendingByClientDate.set(key, pp);
  }

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

  // Preload all products for fallback color lookup
  const allProduits = await prisma.produit.findMany({ select: { nom: true, couleur: true } });
  const produitColorMap = new Map(allProduits.map(p => [p.nom, p.couleur]));

  for (const delivery of deliveries) {
    const dDate = fmtDate(delivery.tournee.date);
    const clientName = delivery.client?.nom || '';
    const fw = clientFirstWord(clientName);

    // Get product type — preparation (machine assignée) is the source of truth
    let produitNom: string | null = null;
    let produitCouleur: string | null = null;

    // 1. Priorité: préparation (machine réellement assignée par l'admin)
    const machineFromPrep = findMachine(clientName, dDate, '');
    if (machineFromPrep) {
      produitNom = machineFromPrep.type;
      produitCouleur = produitColorMap.get(machineFromPrep.type) || null;
    }

    // 2. Fallback: produit assigné sur le point de tournée
    if (!produitNom && delivery.produits?.[0]?.produit?.nom) {
      produitNom = delivery.produits[0].produit.nom;
      produitCouleur = delivery.produits[0].produit.couleur || null;
    }

    // 3. Fallback: pending_point (info Google Calendar)
    if (!produitNom) {
      const ppKey = `${fw}|${dDate}`;
      const pp = pendingByClientDate.get(ppKey);
      if (pp?.produitNom) {
        produitNom = pp.produitNom;
        produitCouleur = produitColorMap.get(pp.produitNom) || null;
      }
    }

    if (!produitNom) produitNom = '?';

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

    // Skip if block doesn't overlap visible range
    if (dateEnd < dateFrom || dateStart > dateTo) continue;

    // Skip completed events (both delivery and pickup done)
    if (delivery.statut === 'termine' && pickup?.statut === 'termine') continue;

    let status: AllocationBlock['status'] = 'immobilisee';
    if (delivery.statut === 'termine') status = 'livree';

    const machine = findMachine(clientName, dDate, produitNom);
    usedDeliveryClients.add(fw + '|' + dDate);

    // Find preparateur name if prep exists
    const prepKey = `${fw}|${dDate}`;
    const linkedPreps = prepsByClient.get(prepKey);
    const preparateur = linkedPreps?.[0]?.preparateur || null;

    blocks.push({
      id: delivery.id,
      client: clientName,
      clientAdresse: delivery.client?.adresse ? `${delivery.client.adresse}, ${delivery.client.codePostal || ''} ${delivery.client.ville || ''}`.trim() : null,
      clientVille: delivery.client?.ville || null,
      clientTelephone: delivery.client?.telephone || delivery.client?.contactTelephone || null,
      clientContactNom: delivery.client?.contactNom || null,
      produit: produitNom,
      produitCouleur: produitCouleur || '#6B7280',
      dateStart, timeStart, dateEnd, timeEnd,
      machineNumero: machine?.numero || null,
      machineType: machine?.type || null,
      status,
      source: 'tournee',
      tourneeId: delivery.tournee.id,
      deliveryPointId: delivery.id,
      pickupPointId: pickup?.id || null,
      notesInternes: delivery.notesInternes || null,
      preparateurNom: preparateur,
    });
  }

  // ========== SOURCE 3: Pending points NOT dispatched ==========
  // Include livraisons before the range (up to 14 days) whose pickup might be in the range
  const pendingPoints = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: extFrom, lte: to },
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

    // Skip if the block doesn't overlap with the visible range
    if (dateEnd < dateFrom || ppDate > dateTo) continue;

    const machine = findMachine(pp.clientName, ppDate, pp.produitNom);

    // Get product color
    const produit = await prisma.produit.findFirst({ where: { nom: pp.produitNom }, select: { couleur: true } });

    blocks.push({
      id: `pp-${pp.id}`,
      client: pp.clientName,
      clientAdresse: (pp as any).adresse || null,
      clientVille: null,
      clientTelephone: (pp as any).contactTelephone || null,
      clientContactNom: (pp as any).contactNom || null,
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
      tourneeId: null,
      deliveryPointId: null,
      pickupPointId: null,
      notesInternes: (pp as any).notes || null,
      preparateurNom: null,
    });
  }

  // ========== SOURCE 4: Preparations without matching points/pending ==========
  for (const prep of preparations) {
    const prepDate = fmtDate(prep.dateEvenement);
    if (prepDate < dateFrom || prepDate > dateTo) continue;
    if (prep.statut === 'disponible' || prep.statut === 'archivee') continue;

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
      clientAdresse: null,
      clientVille: null,
      clientTelephone: null,
      clientContactNom: null,
      produit: prep.machine.type,
      produitCouleur: prep.machine.couleur || '#6B7280',
      dateStart: prepDate,
      timeStart: '00:00',
      dateEnd: prepDate,
      timeEnd: '23:59',
      machineNumero: prep.machine.numero,
      machineType: prep.machine.type,
      status: 'immobilisee',
      source: 'preparation',
      tourneeId: null,
      deliveryPointId: null,
      pickupPointId: null,
      notesInternes: prep.notes || null,
      preparateurNom: prep.preparateur || null,
    });
  }

  // Sort by dateStart then timeStart
  blocks.sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.timeStart.localeCompare(b.timeStart));

  return apiResponse.success(res, blocks);
});

/**
 * POST /api/agenda/optimize
 * Auto-assign machines to events in a date range, maximizing machine reuse.
 * Uses a 4-hour margin between events on the same machine.
 * Body: { dateFrom, dateTo }
 */
export const optimizeAssignments = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) return apiResponse.badRequest(res, 'dateFrom et dateTo requis');

  const MARGIN_HOURS = 4;
  const MARGIN_MS = MARGIN_HOURS * 60 * 60 * 1000;

  // Get all allocations for the period
  const fakeReq = { query: { dateFrom, dateTo }, headers: req.headers } as any;
  let blocks: AllocationBlock[] = [];
  const fakeRes = { status: () => fakeRes, json: (body: any) => { blocks = body.data || []; return fakeRes; } } as any;
  await getAllocations(fakeReq, fakeRes, (() => {}) as any);

  // Get all machines grouped by type
  const allMachines = await prisma.machine.findMany({
    where: { actif: true },
    orderBy: [{ type: 'asc' }, { numero: 'asc' }],
  });

  // Exclude hors_service machines
  const hsIds = new Set(
    (await prisma.preparation.findMany({ where: { statut: 'hors_service' }, select: { machineId: true } }))
      .map(p => p.machineId)
  );

  const machinesByType: Record<string, typeof allMachines> = {};
  for (const m of allMachines) {
    if (hsIds.has(m.id)) continue;
    if (!machinesByType[m.type]) machinesByType[m.type] = [];
    machinesByType[m.type]!.push(m);
  }

  // Sort machines by numero (numeric sort: V1, V2, ... V10, V11)
  for (const type of Object.keys(machinesByType)) {
    machinesByType[type]!.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
  }

  // Group blocks by product type and sort by start datetime
  const blocksByType: Record<string, AllocationBlock[]> = {};
  for (const b of blocks) {
    if (!b.produit || b.produit === '?') continue;
    if (!blocksByType[b.produit]) blocksByType[b.produit] = [];
    blocksByType[b.produit]!.push(b);
  }
  for (const type of Object.keys(blocksByType)) {
    blocksByType[type]!.sort((a, b) => {
      const da = `${a.dateStart}T${a.timeStart}`;
      const db = `${b.dateStart}T${b.timeStart}`;
      return da.localeCompare(db);
    });
  }

  // Bin-packing: for each type, assign blocks to machines to maximize reuse
  let assigned = 0;
  let skipped = 0;

  function blockEndMs(b: AllocationBlock): number {
    return new Date(`${b.dateEnd}T${b.timeEnd !== '23:59' ? b.timeEnd : '23:00'}:00Z`).getTime();
  }
  function blockStartMs(b: AllocationBlock): number {
    return new Date(`${b.dateStart}T${b.timeStart !== '00:00' ? b.timeStart : '01:00'}:00Z`).getTime();
  }

  for (const [type, typeBlocks] of Object.entries(blocksByType)) {
    const typeMachines = machinesByType[type] || [];
    if (typeMachines.length === 0) continue;

    // Track what's assigned to each machine: list of block end times
    const machineSchedule: Map<string, { endMs: number }[]> = new Map();
    for (const m of typeMachines) {
      machineSchedule.set(m.id, []);
    }

    for (const block of typeBlocks) {
      const startMs = blockStartMs(block);
      let bestMachineId: string | null = null;

      // Find the machine where this block fits (respecting 4h margin)
      // and whose last event ends closest (maximize packing)
      let bestGap = Infinity;

      for (const machine of typeMachines) {
        const schedule = machineSchedule.get(machine.id)!;
        // Check if block fits: no overlap and >= 4h margin after last event
        const hasConflict = schedule.some(s => {
          // The last end + margin must be before this block's start
          return (s.endMs + MARGIN_MS) > startMs;
        });

        if (!hasConflict) {
          // Find gap from last event end to this block start
          const lastEnd = schedule.length > 0 ? Math.max(...schedule.map(s => s.endMs)) : 0;
          const gap = startMs - lastEnd;
          if (gap < bestGap) {
            bestGap = gap;
            bestMachineId = machine.id;
          }
        }
      }

      if (!bestMachineId) {
        // No machine available with 4h margin — assign to first machine with no time overlap
        for (const machine of typeMachines) {
          const schedule = machineSchedule.get(machine.id)!;
          const hasOverlap = schedule.some(s => s.endMs > startMs);
          if (!hasOverlap) {
            bestMachineId = machine.id;
            break;
          }
        }
      }

      if (!bestMachineId) {
        skipped++;
        continue;
      }

      // Record the assignment
      machineSchedule.get(bestMachineId)!.push({ endMs: blockEndMs(block) });

      // Create/update preparation
      const machine = typeMachines.find(m => m.id === bestMachineId)!;
      const eventDate = new Date(block.dateStart + 'T12:00:00Z');
      const clientFw = block.client.toLowerCase().trim().split(/[+\s]/)[0]?.trim() || '';

      const existingPrep = await prisma.preparation.findFirst({
        where: {
          dateEvenement: eventDate,
          client: { contains: clientFw, mode: 'insensitive' },
          statut: { notIn: ['archivee', 'disponible'] },
        },
      });

      if (existingPrep) {
        if (existingPrep.machineId !== bestMachineId) {
          await prisma.preparation.update({
            where: { id: existingPrep.id },
            data: { machineId: bestMachineId },
          });
          assigned++;
        }
      } else {
        await prisma.preparation.create({
          data: {
            machineId: bestMachineId,
            dateEvenement: eventDate,
            client: block.client,
            preparateur: 'Auto',
            statut: 'en_preparation',
          },
        });
        assigned++;

        // Mark pending point as used
        const pp = await prisma.pendingPoint.findFirst({
          where: { clientName: { contains: clientFw, mode: 'insensitive' }, date: eventDate, type: 'livraison' },
        });
        if (pp) await prisma.pendingPoint.update({ where: { id: pp.id }, data: { usedInPreparation: true } });
      }
    }
  }

  return apiResponse.success(res, {
    assigned,
    skipped,
    message: `${assigned} assignation(s), ${skipped} non placée(s)`,
  });
});

/**
 * POST /api/agenda/check-margin
 * Check if assigning a block to a machine respects the 4h margin
 * Body: { targetMachineId, dateStart, timeStart, dateEnd, timeEnd }
 */
export const checkMargin = asyncHandler(async (req: Request, res: Response) => {
  const { targetMachineId, dateStart, timeStart, dateEnd, timeEnd, dateFrom, dateTo } = req.body;
  const MARGIN_HOURS = 4;
  const MARGIN_MS = MARGIN_HOURS * 60 * 60 * 1000;

  // Get the machine info
  const machine = await prisma.machine.findUnique({ where: { id: targetMachineId } });
  if (!machine) return apiResponse.success(res, { ok: true, warnings: [] });

  // Get all allocations for the machine in the period
  const fakeReq = { query: { dateFrom: dateFrom || dateStart, dateTo: dateTo || dateEnd }, headers: req.headers } as any;
  let blocks: AllocationBlock[] = [];
  const fakeRes = { status: () => fakeRes, json: (body: any) => { blocks = body.data || []; return fakeRes; } } as any;
  await getAllocations(fakeReq, fakeRes, (() => {}) as any);

  // Filter blocks for this machine
  const machineBlocks = blocks.filter(b => b.machineNumero === machine.numero && b.produit === machine.type);

  const newStart = new Date(`${dateStart}T${timeStart || '00:00'}:00Z`).getTime();
  const newEnd = new Date(`${dateEnd}T${timeEnd || '23:00'}:00Z`).getTime();

  const warnings: string[] = [];
  for (const b of machineBlocks) {
    const bEnd = new Date(`${b.dateEnd}T${b.timeEnd !== '23:59' ? b.timeEnd : '23:00'}:00Z`).getTime();
    const bStart = new Date(`${b.dateStart}T${b.timeStart !== '00:00' ? b.timeStart : '01:00'}:00Z`).getTime();

    // Check gap before
    if (bEnd <= newStart && (newStart - bEnd) < MARGIN_MS) {
      const gapH = Math.round((newStart - bEnd) / 3600000 * 10) / 10;
      warnings.push(`Seulement ${gapH}h après "${b.client}" (fin ${b.timeEnd}) — marge recommandée: ${MARGIN_HOURS}h`);
    }
    // Check gap after
    if (newEnd <= bStart && (bStart - newEnd) < MARGIN_MS) {
      const gapH = Math.round((bStart - newEnd) / 3600000 * 10) / 10;
      warnings.push(`Seulement ${gapH}h avant "${b.client}" (début ${b.timeStart}) — marge recommandée: ${MARGIN_HOURS}h`);
    }
  }

  return apiResponse.success(res, { ok: warnings.length === 0, warnings });
});

/**
 * POST /api/agenda/assign-machine
 * Assign or reassign a machine to an event by creating/updating a preparation
 * Body: { blockId, targetMachineId, client, dateEvenement }
 */
export const assignMachine = asyncHandler(async (req: Request, res: Response) => {
  const { blockId, targetMachineId, client, dateEvenement } = req.body;

  if (!targetMachineId || !client || !dateEvenement) {
    return apiResponse.badRequest(res, 'targetMachineId, client et dateEvenement requis');
  }

  // Verify target machine exists
  const machine = await prisma.machine.findUnique({ where: { id: targetMachineId } });
  if (!machine) return apiResponse.notFound(res, 'Machine non trouvée');

  const eventDate = new Date(dateEvenement + 'T12:00:00Z');
  const clientLower = client.toLowerCase().trim();
  const clientFw = clientLower.split(/[+\s]/)[0]?.trim() || clientLower;

  // Check if there's already a preparation for this client + date on another machine
  const existingPrep = await prisma.preparation.findFirst({
    where: {
      dateEvenement: eventDate,
      client: { contains: clientFw, mode: 'insensitive' },
      statut: { notIn: ['archivee', 'disponible'] },
    },
  });

  if (existingPrep) {
    // Reassign: update existing preparation to the new machine
    const updated = await prisma.preparation.update({
      where: { id: existingPrep.id },
      data: { machineId: targetMachineId },
      include: { machine: true },
    });
    return apiResponse.success(res, { action: 'reassigned', preparation: updated });
  }

  // Create new preparation
  const newPrep = await prisma.preparation.create({
    data: {
      machineId: targetMachineId,
      dateEvenement: eventDate,
      client,
      preparateur: 'Admin',
      statut: 'en_preparation',
    },
    include: { machine: true },
  });

  // Mark pending point as used if exists
  const pendingPoint = await prisma.pendingPoint.findFirst({
    where: {
      clientName: { contains: clientFw, mode: 'insensitive' },
      date: eventDate,
      type: 'livraison',
    },
  });
  if (pendingPoint) {
    await prisma.pendingPoint.update({
      where: { id: pendingPoint.id },
      data: { usedInPreparation: true },
    });
  }

  return apiResponse.success(res, { action: 'created', preparation: newPrep });
});

/**
 * GET /api/agenda/stock?dateFrom=&dateTo=
 * Computes stock by calling getAllocations internally and counting
 * how many machines of each type are occupied on each day (including multi-day spans).
 */
export const getStock = asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
  if (!dateFrom || !dateTo) return apiResponse.badRequest(res, 'dateFrom et dateTo requis');

  // Total machines per type
  const machines = await prisma.machine.findMany({ where: { actif: true }, select: { type: true } });
  const totalByType: Record<string, number> = {};
  for (const m of machines) totalByType[m.type] = (totalByType[m.type] || 0) + 1;

  // HS count
  const hsPreps = await prisma.preparation.findMany({
    where: { statut: 'hors_service' },
    include: { machine: { select: { type: true } } },
  });
  const hsByType: Record<string, number> = {};
  for (const hs of hsPreps) hsByType[hs.machine.type] = (hsByType[hs.machine.type] || 0) + 1;

  // Get allocations via the same logic as getAllocations
  // We call it internally by building a fake req/res
  const fakeReq = { query: { dateFrom, dateTo }, headers: req.headers } as any;
  let allocBlocks: AllocationBlock[] = [];
  const fakeRes = {
    status: () => fakeRes,
    json: (body: any) => { allocBlocks = body.data || []; return fakeRes; },
  } as any;
  await getAllocations(fakeReq, fakeRes, (() => {}) as any);

  // Build day grid
  const days: Record<string, Record<string, number>> = {};
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().substring(0, 10);
    days[ds] = {};
    for (const type of Object.keys(totalByType)) days[ds]![type] = 0;
  }

  // For each allocation block, mark every day it spans as occupied
  for (const block of allocBlocks) {
    const prodType = block.produit;
    if (!prodType || prodType === '?') continue;

    // Iterate through each day in the range
    const bStart = new Date(block.dateStart + 'T00:00:00Z');
    const bEnd = new Date(block.dateEnd + 'T00:00:00Z');
    for (let d = new Date(bStart); d <= bEnd; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().substring(0, 10);
      if (days[ds] && days[ds]![prodType] !== undefined) {
        days[ds]![prodType]!++;
      }
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

import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ensureDateUTC } from '../utils/dateUtils.js';

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
    include: { suggestedMachine: { select: { id: true, type: true, numero: true, couleur: true } } },
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

    // 1. Préparation validée (source of truth)
    const preps = prepsByClient.get(key);
    if (preps) {
      const match = preps.find(p => p.machine.type === produitNom) || preps[0];
      if (match) return { numero: match.machine.numero, type: match.machine.type };
    }

    // 2. Suggestion depuis pending point
    const pp = pendingByClientDate.get(key);
    if (pp?.suggestedMachine) {
      return { numero: pp.suggestedMachine.numero, type: pp.suggestedMachine.type };
    }

    return null;
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

    // 2. Pending point (Google Calendar, toujours à jour après sync)
    if (!produitNom) {
      const ppKey = `${fw}|${dDate}`;
      const pp = pendingByClientDate.get(ppKey);
      if (pp?.produitNom) {
        produitNom = pp.produitNom;
        produitCouleur = produitColorMap.get(pp.produitNom) || null;
      }
    }

    // 3. Fallback: produit assigné sur le point de tournée
    if (!produitNom && delivery.produits?.[0]?.produit?.nom) {
      produitNom = delivery.produits[0].produit.nom;
      produitCouleur = delivery.produits[0].produit.couleur || null;
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

    const ppProduit = pp.produitNom || '?';
    const machine = findMachine(pp.clientName, ppDate, ppProduit);

    // Get product color
    const produit = pp.produitNom ? await prisma.produit.findFirst({ where: { nom: pp.produitNom }, select: { couleur: true } }) : null;

    blocks.push({
      id: `pp-${pp.id}`,
      client: pp.clientName,
      clientAdresse: (pp as any).adresse || null,
      clientVille: null,
      clientTelephone: (pp as any).contactTelephone || null,
      clientContactNom: (pp as any).contactNom || null,
      produit: ppProduit,
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

      // Store suggestion on pending point (don't create preparation)
      const eventDate = ensureDateUTC(block.dateStart);
      const clientFw = block.client.toLowerCase().trim().split(/[+\s]/)[0]?.trim() || '';

      const pp = await prisma.pendingPoint.findFirst({
        where: { clientName: { contains: clientFw, mode: 'insensitive' }, date: eventDate, type: 'livraison' },
      });
      if (pp) {
        await prisma.pendingPoint.update({
          where: { id: pp.id },
          data: { suggestedMachineId: bestMachineId, ignoredInPreparation: false },
        });
        assigned++;
      } else {
        skipped++;
      }
    }
  }

  // Notifier la page préparations en temps réel
  if (assigned > 0) {
    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});
  }

  return apiResponse.success(res, {
    assigned,
    skipped,
    message: `${assigned} suggestion(s), ${skipped} non placée(s)`,
  });
});

/**
 * POST /api/agenda/check-margin
 * Check if assigning a block to a machine respects the 4h margin
 * Body: { targetMachineId, dateStart, timeStart, dateEnd, timeEnd }
 */
export const checkMargin = asyncHandler(async (req: Request, res: Response) => {
  const { targetMachineId, dateStart, timeStart, dateEnd, timeEnd, blockClient } = req.body;
  const MARGIN_HOURS = 4;
  const MARGIN_MS = MARGIN_HOURS * 60 * 60 * 1000;

  const machine = await prisma.machine.findUnique({ where: { id: targetMachineId } });
  if (!machine) return apiResponse.success(res, { ok: true, warnings: [] });

  // Get all OTHER preparations on this machine (not the one being moved)
  const preps = await prisma.preparation.findMany({
    where: {
      machineId: targetMachineId,
      statut: { notIn: ['archivee', 'disponible', 'hors_service'] },
    },
    include: { machine: true },
  });

  // Also get points to find delivery/pickup times for each prep
  const warnings: string[] = [];
  const newStart = new Date(`${dateStart}T${timeStart || '00:00'}:00Z`).getTime();
  const newEnd = new Date(`${dateEnd}T${timeEnd || '23:59'}:00Z`).getTime();
  const blockClientLower = (blockClient || '').toLowerCase().trim();

  for (const prep of preps) {
    // Skip the block being moved
    if (blockClientLower && prep.client.toLowerCase().trim() === blockClientLower) continue;
    const prepFw = prep.client.toLowerCase().trim().split(/[+\s]/)[0]?.trim() || '';
    const blockFw = blockClientLower.split(/[+\s]/)[0]?.trim() || '';
    if (blockFw && blockFw.length > 2 && prepFw === blockFw) continue;

    // Find the delivery+pickup points for this prep to get actual time window
    const prepDate = fmtDate(prep.dateEvenement);
    const fw = clientFirstWord(prep.client);

    // Look for matching points
    const deliveryPoint = await prisma.point.findFirst({
      where: {
        tournee: { date: prep.dateEvenement },
        client: { nom: { contains: fw, mode: 'insensitive' } },
        type: { in: ['livraison', 'livraison_ramassage'] },
      },
      include: { tournee: { select: { date: true } } },
    });

    const pickupPoint = await prisma.point.findFirst({
      where: {
        tournee: { date: { gte: prep.dateEvenement } },
        client: { nom: { contains: fw, mode: 'insensitive' } },
        type: { in: ['ramassage', 'livraison_ramassage'] },
      },
      include: { tournee: { select: { date: true } } },
      orderBy: { tournee: { date: 'asc' } },
    });

    // Also check pending points
    const pendingDelivery = await prisma.pendingPoint.findFirst({
      where: { clientName: { contains: fw, mode: 'insensitive' }, date: prep.dateEvenement, type: 'livraison' },
    });
    const pendingPickup = await prisma.pendingPoint.findFirst({
      where: { clientName: { contains: fw, mode: 'insensitive' }, type: 'ramassage', date: { gte: prep.dateEvenement } },
      orderBy: { date: 'asc' },
    });

    const bStartDate = prepDate;
    const bStartTime = (deliveryPoint?.creneauDebut ? fmtTime(deliveryPoint.creneauDebut) : pendingDelivery?.creneauDebut) || '00:00';
    const bEndDate = pickupPoint ? fmtDate(pickupPoint.tournee.date) : pendingPickup ? fmtDate(pendingPickup.date) : prepDate;
    const bEndTime = (pickupPoint?.creneauFin ? fmtTime(pickupPoint.creneauFin) : pendingPickup?.creneauFin) || '23:59';

    const bStart = new Date(`${bStartDate}T${bStartTime}:00Z`).getTime();
    const bEnd = new Date(`${bEndDate}T${bEndTime}:00Z`).getTime();

    // Check overlap
    if (newStart < bEnd && newEnd > bStart) {
      warnings.push(`Chevauche "${prep.client}" (${bStartDate} ${bStartTime} → ${bEndDate} ${bEndTime})`);
      continue;
    }

    // Check gap before
    if (bEnd <= newStart && (newStart - bEnd) < MARGIN_MS) {
      const gapH = Math.round((newStart - bEnd) / 3600000 * 10) / 10;
      warnings.push(`Seulement ${gapH}h après "${prep.client}" (fin ${bEndTime} le ${bEndDate}) — marge recommandée: ${MARGIN_HOURS}h`);
    }
    // Check gap after
    if (newEnd <= bStart && (bStart - newEnd) < MARGIN_MS) {
      const gapH = Math.round((bStart - newEnd) / 3600000 * 10) / 10;
      warnings.push(`Seulement ${gapH}h avant "${prep.client}" (début ${bStartTime} le ${bStartDate}) — marge recommandée: ${MARGIN_HOURS}h`);
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

  const eventDate = ensureDateUTC(dateEvenement);

  // Store suggestion on pending point (don't create preparation)
  const searchClient = client.length > 5 ? client.substring(0, Math.min(client.length, 20)) : client;
  const pendingPoint = await prisma.pendingPoint.findFirst({
    where: {
      clientName: { contains: searchClient, mode: 'insensitive' },
      date: eventDate,
      type: 'livraison',
    },
  });

  const { socketEmit } = await import('../config/socket.js');

  if (pendingPoint) {
    await prisma.pendingPoint.update({
      where: { id: pendingPoint.id },
      data: { suggestedMachineId: targetMachineId, ignoredInPreparation: false },
    });
    socketEmit.toAdmins('machines:updated', {});
    return apiResponse.success(res, {
      action: 'suggested',
      suggestion: { pendingPointId: pendingPoint.id, machineId: targetMachineId, client, dateEvenement },
    });
  }

  // Pas de pending point trouvé — créer la suggestion manuellement
  const manualPp = await prisma.pendingPoint.create({
    data: {
      date: eventDate,
      clientName: client,
      type: 'livraison',
      produitNom: machine.type,
      source: 'manual',
      suggestedMachineId: targetMachineId,
    },
  });

  socketEmit.toAdmins('machines:updated', {});
  return apiResponse.success(res, {
    action: 'suggested',
    suggestion: { pendingPointId: manualPp.id, machineId: targetMachineId, client, dateEvenement },
  });
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

  // Get hors_service machine IDs
  const hsPreps = await prisma.preparation.findMany({
    where: { statut: 'hors_service' },
    select: { machineId: true },
  });
  const hsIds = new Set(hsPreps.map(p => p.machineId));

  // Compter les suggestions et preps en_preparation par borne
  const suggestionsCount = await prisma.pendingPoint.groupBy({
    by: ['suggestedMachineId'],
    where: { suggestedMachineId: { not: null }, usedInPreparation: false, ignoredInPreparation: false, type: 'livraison' },
    _count: true,
  });
  const suggestMap = new Map(suggestionsCount.map(s => [s.suggestedMachineId!, s._count]));

  const enPrepCount = await prisma.preparation.groupBy({
    by: ['machineId'],
    where: { statut: 'en_preparation' },
    _count: true,
  });
  const enPrepMap = new Map(enPrepCount.map(p => [p.machineId, p._count]));

  const enriched = machines.map(m => ({
    ...m,
    horsService: hsIds.has(m.id),
    suggestionsCount: suggestMap.get(m.id) || 0,
    validatedCount: enPrepMap.get(m.id) || 0,
  }));
  const grouped: Record<string, typeof enriched> = {};
  for (const m of enriched) { if (!grouped[m.type]) grouped[m.type] = []; grouped[m.type]!.push(m); }
  return apiResponse.success(res, grouped);
});

/**
 * POST /api/agenda/validate-machine
 * Valide les suggestions d'une borne : crée les préparations en statut en_preparation
 * Body: { machineId }
 */
export const validateMachine = asyncHandler(async (req: Request, res: Response) => {
  const { machineId, blocks } = req.body as { machineId: string; blocks?: Array<{ client: string; dateStart: string }> };
  if (!machineId) return apiResponse.badRequest(res, 'machineId requis');

  const machine = await prisma.machine.findUnique({ where: { id: machineId } });
  if (!machine) return apiResponse.notFound(res, 'Machine non trouvée');

  // Vérifier qu'il n'y a pas déjà des preps en_preparation
  const existingPreps = await prisma.preparation.findMany({
    where: { machineId, statut: 'en_preparation' },
  });
  if (existingPreps.length > 0) {
    return apiResponse.success(res, { created: 0, message: 'Borne déjà validée' });
  }

  if (!blocks || blocks.length === 0) {
    return apiResponse.success(res, { created: 0, message: 'Aucun bloc envoyé' });
  }

  let created = 0;
  const processedClients = new Set<string>();

  for (const block of blocks) {
    const clientFw = block.client.toLowerCase().trim().split(/[+\s]/)[0]?.trim() || '';
    if (clientFw.length < 2) continue;

    // Éviter les doublons (même client, même date)
    const dedupKey = `${clientFw}|${block.dateStart}`;
    if (processedClients.has(dedupKey)) continue;
    processedClients.add(dedupKey);

    const eventDate = ensureDateUTC(block.dateStart);

    // Chercher un pending point correspondant
    const pp = await prisma.pendingPoint.findFirst({
      where: {
        clientName: { contains: clientFw, mode: 'insensitive' },
        date: eventDate,
        type: 'livraison',
        usedInPreparation: false,
        ignoredInPreparation: false,
      },
    });

    if (pp) {
      // Créer la préparation liée au pending point
      await prisma.preparation.create({
        data: {
          machineId,
          dateEvenement: pp.date,
          client: pp.clientName,
          preparateur: 'À préparer',
          statut: 'en_preparation',
          pendingPointId: pp.id,
        },
      });
      await prisma.pendingPoint.update({
        where: { id: pp.id },
        data: { usedInPreparation: true, suggestedMachineId: machineId },
      });
      created++;
    } else {
      // Pas de pending point → créer la préparation directement depuis les infos du bloc
      await prisma.preparation.create({
        data: {
          machineId,
          dateEvenement: eventDate,
          client: block.client,
          preparateur: 'À préparer',
          statut: 'en_preparation',
        },
      });
      created++;
    }
  }

  if (created > 0) {
    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});
    socketEmit.toAdmins('preparation:created', {});
  }

  return apiResponse.success(res, {
    created,
    machine: `${machine.type} ${machine.numero}`,
    message: `${created} préparation(s) envoyée(s) pour ${machine.type} ${machine.numero}`,
  });
});

/**
 * POST /api/agenda/validate-type
 * Valide toutes les suggestions de toutes les bornes d'un type
 * Body: { machineType }
 */
export const validateType = asyncHandler(async (req: Request, res: Response) => {
  const { machineType, machineBlocks } = req.body as {
    machineType: string;
    machineBlocks?: Array<{ machineId: string; blocks: Array<{ client: string; dateStart: string }> }>;
  };
  if (!machineType) return apiResponse.badRequest(res, 'machineType requis');

  let totalCreated = 0;
  let machineCount = 0;

  // Pour chaque borne avec des blocs, valider
  if (machineBlocks && machineBlocks.length > 0) {
    for (const mb of machineBlocks) {
      // Vérifier pas déjà validée
      const existing = await prisma.preparation.findFirst({
        where: { machineId: mb.machineId, statut: 'en_preparation' },
      });
      if (existing) continue;

      let created = 0;
      const processedClients = new Set<string>();
      for (const block of mb.blocks) {
        const clientFw = block.client.toLowerCase().trim().split(/[+\s]/)[0]?.trim() || '';
        if (clientFw.length < 2) continue;
        const dedupKey = `${clientFw}|${block.dateStart}`;
        if (processedClients.has(dedupKey)) continue;
        processedClients.add(dedupKey);

        const eventDate = ensureDateUTC(block.dateStart);
        const pp = await prisma.pendingPoint.findFirst({
          where: {
            clientName: { contains: clientFw, mode: 'insensitive' },
            date: eventDate,
            type: 'livraison',
            usedInPreparation: false,
            ignoredInPreparation: false,
          },
        });
        if (pp) {
          await prisma.preparation.create({
            data: {
              machineId: mb.machineId,
              dateEvenement: pp.date,
              client: pp.clientName,
              preparateur: 'À préparer',
              statut: 'en_preparation',
              pendingPointId: pp.id,
            },
          });
          await prisma.pendingPoint.update({
            where: { id: pp.id },
            data: { usedInPreparation: true, suggestedMachineId: mb.machineId },
          });
          created++;
        } else {
          // Pas de pending point → créer directement
          await prisma.preparation.create({
            data: {
              machineId: mb.machineId,
              dateEvenement: eventDate,
              client: block.client,
              preparateur: 'À préparer',
              statut: 'en_preparation',
            },
          });
          created++;
        }
      }
      if (created > 0) { totalCreated += created; machineCount++; }
    }
  }

  if (totalCreated > 0) {
    const { socketEmit } = await import('../config/socket.js');
    socketEmit.toAdmins('machines:updated', {});
    socketEmit.toAdmins('preparation:created', {});
  }

  return apiResponse.success(res, {
    created: totalCreated,
    machines: machineCount,
    message: `${totalCreated} préparation(s) envoyée(s) sur ${machineCount} borne(s) ${machineType}`,
  });
});

/**
 * POST /api/agenda/unlock-machine
 * Déverrouille une borne : supprime les préparations en_preparation et restaure les suggestions
 * Body: { machineId }
 */
export const unlockMachine = asyncHandler(async (req: Request, res: Response) => {
  const { machineId } = req.body;
  if (!machineId) return apiResponse.badRequest(res, 'machineId requis');

  // Trouver les preps en_preparation pour cette borne
  const preps = await prisma.preparation.findMany({
    where: { machineId, statut: 'en_preparation' },
    select: { id: true, pendingPointId: true },
  });

  if (preps.length === 0) {
    return apiResponse.success(res, { deleted: 0, message: 'Aucune préparation à déverrouiller' });
  }

  // Restaurer les pending points
  const ppIds = preps.map(p => p.pendingPointId).filter(Boolean) as string[];
  if (ppIds.length > 0) {
    await prisma.pendingPoint.updateMany({
      where: { id: { in: ppIds } },
      data: { usedInPreparation: false },
    });
  }

  // Supprimer les preps
  await prisma.preparation.deleteMany({
    where: { id: { in: preps.map(p => p.id) } },
  });

  const { socketEmit } = await import('../config/socket.js');
  socketEmit.toAdmins('machines:updated', {});

  return apiResponse.success(res, {
    deleted: preps.length,
    message: `${preps.length} préparation(s) déverrouillée(s)`,
  });
});

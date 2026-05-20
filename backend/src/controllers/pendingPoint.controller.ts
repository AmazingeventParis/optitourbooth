import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { ensureDateUTC } from '../utils/dateUtils.js';
import { syncGoogleCalendarEvents } from '../services/googleCalendar.service.js';
import { syncCrmPendingPoints } from '../services/crmSync.service.js';

// ─── Helpers CRM import ──────────────────────────────────────────────────────

function parseCreneau(raw: string): { debut: string; fin: string } | null {
  const cleaned = (raw || '').replace(/\s/g, '');
  const m = cleaned.match(/(\d{1,2})h?(\d{0,2})[–\-à](\d{1,2})h?(\d{0,2})/);
  if (!m) return null;
  const pad = (n: string | undefined) => (n || '0').padStart(2, '0');
  return {
    debut: `${pad(m[1])}:${m[2] ? m[2].padStart(2, '0') : '00'}`,
    fin:   `${pad(m[3])}:${m[4] ? m[4].padStart(2, '0') : '00'}`,
  };
}

function normalizeDateDMY(dmy: string): string | null {
  // Converts "25.05.2026" or "25-05-2026" → "2026-05-25"
  const m = (dmy || '').match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${(m[2] || '01').padStart(2, '0')}-${(m[1] || '01').padStart(2, '0')}`;
}

type LogisticsPayload = {
  date: string | null;
  adresse: string | null;
  creneauDebut: string | null;
  creneauFin: string | null;
  contactNom: string | null;
  contactTelephone: string | null;
  notes: string | null;
};

function buildAddress(num?: string, rue?: string, cp?: string, ville?: string): string {
  return [
    [num, rue].filter(Boolean).join(' '),
    [cp, ville].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
}

function parseLogisticsPayload(d: Record<string, string>, type: 'livraison' | 'ramassage', logType: string): LogisticsPayload | null {
  if (logType === 'retrait') return null;

  if (logType === 'chronopost') {
    const adresse = buildAddress(d.log_chrono_rue_num, d.log_chrono_rue_nom, d.log_chrono_cp, d.log_chrono_ville);
    const contactNom = [d.fac_prenom, d.fac_nom].filter(Boolean).join(' ') || d.log_contact || null;
    return {
      date: d.log_jour_liv || null,
      adresse: adresse || null,
      creneauDebut: null,
      creneauFin: null,
      contactNom,
      contactTelephone: d.log_chrono_tel || null,
      notes: null,
    };
  }

  // classique / premium / spinner
  const isRec = type === 'ramassage';
  const useRecupAddr = isRec && d.log_recup_diff === '1' && d.log_recup_rue_nom;
  const adresse = useRecupAddr
    ? buildAddress(d.log_recup_rue_num, d.log_recup_rue_nom, d.log_recup_cp, d.log_recup_ville)
    : buildAddress(d.log_rue_num, d.log_rue_nom, d.log_cp, d.log_ville);

  const rawDate   = isRec ? d.log_jour_rec : d.log_jour_liv;
  const rawCren   = isRec ? d.log_creneau_rec : d.log_creneau_liv;
  const cren      = parseCreneau(rawCren || '');
  const noteParts = [d.log_notes, (!isRec && d.log_etage) ? 'Étage sans ascenseur' : ''].filter(Boolean);

  return {
    date: rawDate || null,
    adresse: adresse || null,
    creneauDebut: cren?.debut || null,
    creneauFin:   cren?.fin   || null,
    contactNom:   d.log_contact    || null,
    contactTelephone: d.log_contact_tel || null,
    notes: noteParts.join(' / ') || null,
  };
}

/**
 * POST /api/pending-points - Créer des points à dispatcher (appelé par Google Apps Script)
 */
export async function createPendingPoints(req: Request, res: Response): Promise<void> {
  const { points } = req.body;

  if (!points || !Array.isArray(points) || points.length === 0) {
    apiResponse.badRequest(res, 'Le champ "points" est requis (tableau non vide)');
    return;
  }

  const results = [];

  for (const point of points) {
    if (!point.date || !point.clientName || !point.type) {
      results.push({ error: 'Champs requis: date, clientName, type', point });
      continue;
    }

    try {
      const data = {
        date: ensureDateUTC(point.date),
        clientName: point.clientName,
        adresse: point.adresse || null,
        type: point.type,
        produitNom: point.produitNom || null,
        creneauDebut: point.creneauDebut || null,
        creneauFin: point.creneauFin || null,
        notes: point.notes || null,
        contactNom: point.contactNom || null,
        contactTelephone: point.contactTelephone || null,
        source: point.source || 'google_calendar',
        externalId: point.externalId || null,
      };

      let created;
      if (data.externalId) {
        // Upsert par externalId pour l'idempotence
        created = await prisma.pendingPoint.upsert({
          where: { externalId: data.externalId },
          update: {
            date: data.date,
            clientName: data.clientName,
            adresse: data.adresse,
            type: data.type,
            creneauDebut: data.creneauDebut,
            creneauFin: data.creneauFin,
            notes: data.notes,
            contactNom: data.contactNom,
            contactTelephone: data.contactTelephone,
          },
          create: data,
        });
      } else {
        created = await prisma.pendingPoint.create({ data });
      }

      results.push(created);
    } catch (error) {
      console.error('Erreur création pending point:', error);
      results.push({ error: (error as Error).message, point });
    }
  }

  apiResponse.success(res, {
    total: points.length,
    created: results.filter((r: any) => r.id).length,
    errors: results.filter((r: any) => r.error).length,
    results,
  });
}

/**
 * POST /api/pending-points/manual - Créer un point à dispatcher manuellement (admin)
 */
export async function createManualPendingPoint(req: Request, res: Response): Promise<void> {
  const { date, clientName, adresse, type, produitNom, creneauDebut, creneauFin, notes, contactNom, contactTelephone } = req.body;

  if (!date || !clientName || !type) {
    apiResponse.badRequest(res, 'Champs requis: date, clientName, type');
    return;
  }

  const point = await prisma.pendingPoint.create({
    data: {
      date: ensureDateUTC(date),
      clientName,
      adresse: adresse || null,
      type,
      produitNom: produitNom || null,
      creneauDebut: creneauDebut || null,
      creneauFin: creneauFin || null,
      notes: notes || null,
      contactNom: contactNom || null,
      contactTelephone: contactTelephone || null,
      source: 'manual',
    },
  });

  apiResponse.success(res, point);
}

/**
 * GET /api/pending-points?date=YYYY-MM-DD - Lister les points à dispatcher pour une date
 */
export async function listPendingPoints(req: Request, res: Response): Promise<void> {
  const { date, search } = req.query;

  // Mode recherche par nom (admin debug)
  if (search && typeof search === 'string') {
    const points = await prisma.pendingPoint.findMany({
      where: {
        clientName: { contains: search, mode: 'insensitive' },
      },
      orderBy: { date: 'asc' },
    });
    apiResponse.success(res, points);
    return;
  }

  if (!date || typeof date !== 'string') {
    apiResponse.badRequest(res, 'Paramètre "date" requis (YYYY-MM-DD)');
    return;
  }

  const dateStart = ensureDateUTC(date);
  const dateEnd = new Date(date + 'T23:59:59.999Z');

  const points = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: dateStart, lte: dateEnd },
      dispatched: false,
      deletedByUser: false,
    },
    orderBy: { createdAt: 'asc' },
  });

  apiResponse.success(res, points);
}

/**
 * DELETE /api/pending-points/:id
 */
export async function deletePendingPoint(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    const point = await prisma.pendingPoint.findUnique({
      where: { id },
      select: { externalId: true },
    });
    if (!point) {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }

    if (point.externalId) {
      // Soft delete : on préserve le PendingPoint pour que la sync Google Calendar
      // ne le recrée pas au prochain cycle.
      await prisma.pendingPoint.update({
        where: { id },
        data: { deletedByUser: true, dispatched: true },
      });
    } else {
      // Pas d'externalId → point manuel, hard delete OK
      await prisma.pendingPoint.delete({ where: { id } });
    }

    apiResponse.success(res, { message: 'Point supprimé' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/pending-points/:id - Mettre à jour un pending point (édition frontend)
 */
export async function updatePendingPoint(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { clientName, adresse, type, date, creneauDebut, creneauFin, contactNom, contactTelephone, notes, produitNom, dispatched } = req.body;

  try {
    const updated = await prisma.pendingPoint.update({
      where: { id },
      data: {
        ...(clientName !== undefined && { clientName }),
        ...(adresse !== undefined && { adresse }),
        ...(type !== undefined && { type }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(creneauDebut !== undefined && { creneauDebut }),
        ...(creneauFin !== undefined && { creneauFin }),
        ...(contactNom !== undefined && { contactNom }),
        ...(contactTelephone !== undefined && { contactTelephone }),
        ...(notes !== undefined && { notes }),
        ...(produitNom !== undefined && { produitNom }),
        ...(dispatched !== undefined && { dispatched }),
        // Dès qu'un utilisateur modifie un champ, verrouiller contre la sync automatique
        manuallyEdited: true,
      },
    });
    apiResponse.success(res, updated);
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/pending-points/:id/dispatch - Marquer comme dispatché
 */
export async function markDispatched(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    const updated = await prisma.pendingPoint.update({
      where: { id },
      data: { dispatched: true },
    });
    apiResponse.success(res, updated);
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * GET /api/pending-points/calendar-events?calendarType=shootnbox|smakk
 * Liste les événements Google Calendar uniques (groupés par événement)
 * pour le panneau de préparations. Date: aujourd'hui → +15 jours.
 * Exclut les événements déjà utilisés dans une préparation.
 */
export async function listCalendarEvents(req: Request, res: Response): Promise<void> {
  const { calendarType } = req.query;

  const now = new Date();
  const dateStart = ensureDateUTC(now.toISOString().substring(0, 10));
  const dateEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

  // Filtre par calendrier source
  const smakkCalendarId = 'faa39fa21157c487ef3a5007739b04b69a9309cffee9d8bfc4ff09c75958bbd1@group.calendar.google.com';
  let calendarFilter: any = {};
  if (calendarType === 'smakk') {
    calendarFilter = { calendarId: smakkCalendarId };
  } else if (calendarType === 'shootnbox') {
    calendarFilter = { OR: [{ calendarId: { not: smakkCalendarId } }, { calendarId: null }] };
  }

  const points = await prisma.pendingPoint.findMany({
    where: {
      source: 'google_calendar',
      date: { gte: dateStart, lte: dateEnd },
      usedInPreparation: false,
      type: 'livraison',
      ...calendarFilter,
    },
    orderBy: { date: 'asc' },
  });

  // Retourner les événements avec date, client et suggestion de borne
  const events = points.map((p: any) => ({
    id: p.id,
    date: p.date,
    clientName: p.clientName,
    produitNom: p.produitNom,
    adresse: p.adresse,
    externalId: p.externalId,
    suggestedMachineId: p.suggestedMachineId || null,
  }));

  apiResponse.success(res, events);
}

/**
 * PATCH /api/pending-points/:id/use-in-preparation - Marquer comme utilisé dans une préparation
 */
export async function markUsedInPreparation(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    // Marquer le point livraison
    const point = await prisma.pendingPoint.update({
      where: { id },
      data: { usedInPreparation: true },
    });

    // Marquer aussi le point ramassage associé (même externalId racine)
    if (point.externalId) {
      const eventIdBase = point.externalId.replace(/_livraison$/, '').replace(/_ramassage$/, '');
      await prisma.pendingPoint.updateMany({
        where: {
          externalId: { startsWith: eventIdBase },
          usedInPreparation: false,
        },
        data: { usedInPreparation: true },
      });
    }

    apiResponse.success(res, { message: 'Événement marqué comme utilisé' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/pending-points/:id/ignore-suggestion - Ignorer la suggestion de préparation
 */
export async function ignoreSuggestion(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    await prisma.pendingPoint.update({
      where: { id },
      data: { ignoredInPreparation: true },
    });

    apiResponse.success(res, { message: 'Suggestion ignorée' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * PATCH /api/pending-points/:id/restore-suggestion - Restaurer une suggestion ignorée
 */
export async function restoreSuggestion(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    await prisma.pendingPoint.update({
      where: { id },
      data: { ignoredInPreparation: false },
    });

    apiResponse.success(res, { message: 'Suggestion restaurée' });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      apiResponse.notFound(res, 'Point non trouvé');
      return;
    }
    throw error;
  }
}

/**
 * POST /api/pending-points/sync-google-calendar - Lancer une sync manuelle
 */
export async function syncGoogleCalendar(_req: Request, res: Response): Promise<void> {
  try {
    const result = await syncGoogleCalendarEvents();
    apiResponse.success(res, result);
  } catch (error) {
    apiResponse.error(res, 'SYNC_ERROR', `Erreur sync Google Calendar: ${(error as Error).message}`, 500);
  }
}

/**
 * POST /api/pending-points/sync-crm - Sync manuelle CRM → PendingPoints
 * Crée les points à dispatcher depuis orders_ajax.php (delivery=Livraison, hors Vegas Slim)
 * et les enrichit avec les données du formulaire mail-info-client.
 */
export async function syncCrmPendingPointsController(_req: Request, res: Response): Promise<void> {
  try {
    const result = await syncCrmPendingPoints();
    apiResponse.success(res, result);
  } catch (error) {
    apiResponse.error(res, 'SYNC_ERROR', `Erreur sync CRM PendingPoints: ${(error as Error).message}`, 500);
  }
}

/**
 * POST /api/pending-points/import-crm
 * Importe les infos logistiques depuis le formulaire Mail Info Client (shootnbox.fr).
 * Body: { numId: "FA14129", applyUpdate: false }
 * Si applyUpdate=false → preview sans écriture.
 * Si applyUpdate=true  → applique les mises à jour sur les PendingPoints trouvés.
 */
export async function importFromCRM(req: Request, res: Response): Promise<void> {
  const { numId, applyUpdate = false } = req.body;

  if (!numId || typeof numId !== 'string') {
    apiResponse.badRequest(res, 'numId requis (ex: FA14129)');
    return;
  }

  const lookupKey = process.env.CRM_LOOKUP_KEY || 'otb_crm_lookup_2026';
  const lookupUrl = `https://shootnbox.fr/manager2/otb_cfg_lookup.php?key=${lookupKey}&num_id=${encodeURIComponent(numId.toUpperCase())}`;

  let cfgData: any;
  try {
    const resp = await fetch(lookupUrl, { signal: AbortSignal.timeout(15_000) });
    cfgData = await resp.json();
  } catch (err) {
    apiResponse.error(res, 'CRM_FETCH_ERROR', `Impossible de contacter shootnbox.fr: ${(err as Error).message}`, 502);
    return;
  }

  if (cfgData?.error === 'not_found') {
    apiResponse.error(res, 'CRM_NOT_FOUND', `Aucune config trouvée pour ${numId}`, 404);
    return;
  }
  if (cfgData?.error) {
    apiResponse.error(res, 'CRM_ERROR', cfgData.error, 400);
    return;
  }
  if (!cfgData?.submitted || !cfgData?.submitted_data) {
    apiResponse.error(res, 'NOT_SUBMITTED', `Le formulaire client pour ${numId} n'a pas encore été soumis`, 400);
    return;
  }

  const d = cfgData.submitted_data as Record<string, string>;
  const logType: string = cfgData.logistique_type || 'classique';

  const parsedLiv = parseLogisticsPayload(d, 'livraison', logType);
  const parsedRec = parseLogisticsPayload(d, 'ramassage', logType);

  // Dates à chercher: livraison, ramassage + date de l'événement (format DD.MM.YYYY)
  const eventDateISO = normalizeDateDMY(cfgData.event_date || '');
  const allDates = [...new Set([
    parsedLiv?.date,
    parsedRec?.date,
    eventDateISO,
  ].filter((x): x is string => !!x))];

  // Phrases de recherche — societe en entier, puis dernier mot du last_name (unique)
  const namePhrases = ([cfgData.societe, cfgData.last_name] as (string | undefined)[])
    .filter((s): s is string => typeof s === 'string' && s.trim().length >= 3)
    .map((s) => s.trim());

  if (namePhrases.length === 0 && allDates.length === 0) {
    apiResponse.error(res, 'NO_SEARCH_CRITERIA', 'Impossible de construire un critère de recherche', 400);
    return;
  }

  // Plage de dates : de la livraison à la récupération (bornes inclusives)
  const dateFrom = parsedLiv?.date || parsedRec?.date || eventDateISO;
  const dateTo   = parsedRec?.date || parsedLiv?.date || eventDateISO;

  // Stratégie 1 : nom ET plage de dates (précision maximale)
  let candidates: any[] = [];
  if (namePhrases.length > 0 && dateFrom && dateTo) {
    candidates = await prisma.pendingPoint.findMany({
      where: {
        AND: [
          { OR: namePhrases.map(phrase => ({ clientName: { contains: phrase, mode: 'insensitive' as const } })) },
          { date: { gte: ensureDateUTC(dateFrom), lte: ensureDateUTC(dateTo) } },
        ],
        deletedByUser: false,
      },
      orderBy: { date: 'asc' },
    });
  }

  // Stratégie 2 : nom seul, sans contrainte de date (si rien trouvé en stratégie 1)
  if (candidates.length === 0 && namePhrases.length > 0) {
    candidates = await prisma.pendingPoint.findMany({
      where: {
        OR: namePhrases.map(phrase => ({ clientName: { contains: phrase, mode: 'insensitive' as const } })),
        deletedByUser: false,
      },
      orderBy: { date: 'asc' },
    });
  }

  // Stratégie 3 : dates seules (dernier recours)
  if (candidates.length === 0 && allDates.length > 0) {
    candidates = await prisma.pendingPoint.findMany({
      where: { date: { in: allDates.map(d => ensureDateUTC(d)) }, deletedByUser: false },
      orderBy: { date: 'asc' },
    });
  }

  // Calculer le payload de mise à jour pour chaque candidat
  const updatePlan = candidates.map((point: any) => {
    const payload = point.type === 'ramassage' ? parsedRec : parsedLiv;
    return {
      id:          point.id,
      clientName:  point.clientName,
      currentDate: point.date,
      currentType: point.type,
      currentAdresse: point.adresse,
      update: payload ? {
        adresse:          payload.adresse,
        creneauDebut:     payload.creneauDebut,
        creneauFin:       payload.creneauFin,
        contactNom:       payload.contactNom,
        contactTelephone: payload.contactTelephone,
        notes:            payload.notes,
      } : null,
    };
  });

  if (!applyUpdate) {
    apiResponse.success(res, {
      preview: true,
      numId,
      logistiqueType: logType,
      parsedLivraison: parsedLiv,
      parsedRamassage: parsedRec,
      candidatesFound: candidates.length,
      updatePlan,
    });
    return;
  }

  // Appliquer les mises à jour
  const updated: any[] = [];
  for (const plan of updatePlan) {
    if (!plan.update) continue;
    const result = await prisma.pendingPoint.update({
      where: { id: plan.id },
      data: { ...plan.update, manuallyEdited: true },
    });
    updated.push(result);
  }

  apiResponse.success(res, {
    applied: true,
    numId,
    updatedCount: updated.length,
    points: updated,
  });
}

/**
 * POST /api/pending-points/bulk-import-crm
 * Enrichit TOUS les points à dispatcher à venir avec les infos du formulaire Mail Info Client.
 * Source de vérité : shootnbox.fr/manager2 (otb_cfg_bulk.php).
 * Ne touche pas les points déjà dispatched ou deletedByUser.
 * Body: { applyUpdate?: boolean } — default false (preview)
 */
export async function bulkImportFromCRM(req: Request, res: Response): Promise<void> {
  const { applyUpdate = false } = req.body;

  const lookupKey = process.env.CRM_LOOKUP_KEY || 'otb_crm_lookup_2026';
  const bulkUrl = `https://shootnbox.fr/manager2/otb_cfg_bulk.php?key=${lookupKey}`;

  // 1. Récupérer toutes les configs soumises depuis shootnbox.fr
  let crmConfigs: any[];
  try {
    const resp = await fetch(bulkUrl, { signal: AbortSignal.timeout(20_000) });
    const body = await resp.json();
    if (!Array.isArray(body)) throw new Error('Réponse inattendue (pas un tableau)');
    crmConfigs = body;
  } catch (err) {
    apiResponse.error(res, 'CRM_FETCH_ERROR', `Impossible de contacter shootnbox.fr: ${(err as Error).message}`, 502);
    return;
  }

  // 2. Charger tous les PendingPoints à venir non dispatched
  const todayUTC = ensureDateUTC(new Date().toISOString().substring(0, 10));
  const upcomingPoints = await prisma.pendingPoint.findMany({
    where: {
      date: { gte: todayUTC },
      dispatched: false,
      deletedByUser: false,
    },
    orderBy: { date: 'asc' },
  });

  // 3. Pour chaque config CRM, trouver les points correspondants et calculer les mises à jour
  const allUpdates: Array<{
    numId: string;
    societe: string;
    logType: string;
    matchedPoints: Array<{ id: string; type: string; clientName: string }>;
    updatePayload: Record<string, any>;
  }> = [];
  const skipped: Array<{ numId: string; reason: string }> = [];

  for (const cfg of crmConfigs) {
    const numId: string = cfg.num_id || '';
    const logType: string = cfg.logistique_type || 'classique';
    const d = cfg.submitted_data as Record<string, string> | undefined;

    if (!d) {
      skipped.push({ numId, reason: 'pas de submitted_data' });
      continue;
    }

    const parsedLiv = parseLogisticsPayload(d, 'livraison', logType);
    const parsedRec = parseLogisticsPayload(d, 'ramassage', logType);

    if (!parsedLiv && !parsedRec) {
      skipped.push({ numId, reason: `logistique_type=${logType} ignoré (retrait)` });
      continue;
    }

    const eventDateISO = normalizeDateDMY(cfg.event_date || '');
    const allDates = [...new Set([
      parsedLiv?.date,
      parsedRec?.date,
      eventDateISO,
    ].filter((x): x is string => !!x))];

    const namePhrases = ([cfg.societe, cfg.last_name] as (string | undefined)[])
      .filter((s): s is string => typeof s === 'string' && s.trim().length >= 3)
      .map((s) => s.trim());

    const dateFrom = parsedLiv?.date || parsedRec?.date || eventDateISO;
    const dateTo   = parsedRec?.date || parsedLiv?.date || eventDateISO;

    // En mode bulk, n'utiliser que les stratégies à base de nom (jamais dates seules).
    // La stratégie 3 (dates seules) est désactivée : trop de faux positifs quand plusieurs
    // événements tombent le même jour que le client Chronopost/inconnu.
    if (namePhrases.length === 0) {
      skipped.push({ numId, reason: 'nom trop court ou absent — ignoré en bulk (pas de match par dates seules)' });
      continue;
    }

    // Stratégie 1 : nom ET plage de dates
    let candidates = upcomingPoints.filter(p => {
      const pDate = p.date.toISOString().substring(0, 10);
      const nameMatch = namePhrases.some(phrase =>
        p.clientName.toLowerCase().includes(phrase.toLowerCase())
      );
      const dateMatch = !dateFrom || !dateTo || (pDate >= dateFrom && pDate <= dateTo);
      return nameMatch && dateMatch;
    });

    // Stratégie 2 : nom seul si rien trouvé (pas de contrainte de date)
    if (candidates.length === 0) {
      candidates = upcomingPoints.filter(p =>
        namePhrases.some(phrase => p.clientName.toLowerCase().includes(phrase.toLowerCase()))
      );
    }

    // Stratégie 3 (dates seules) désactivée en bulk — trop de faux positifs.

    if (candidates.length === 0) {
      skipped.push({ numId, reason: 'aucun point correspondant au nom trouvé' });
      continue;
    }

    // Construire le payload d'update pour chaque candidat
    for (const point of candidates) {
      const payload = point.type === 'ramassage' ? parsedRec : parsedLiv;
      if (!payload) continue;

      const existing = allUpdates.find(u => u.numId === numId);
      const matchEntry = { id: point.id, type: point.type, clientName: point.clientName };
      if (existing) {
        existing.matchedPoints.push(matchEntry);
      } else {
        allUpdates.push({
          numId,
          societe: cfg.societe || cfg.last_name || '',
          logType,
          matchedPoints: [matchEntry],
          updatePayload: {
            adresse:          payload.adresse,
            creneauDebut:     payload.creneauDebut,
            creneauFin:       payload.creneauFin,
            contactNom:       payload.contactNom,
            contactTelephone: payload.contactTelephone,
            notes:            payload.notes,
          },
        });
      }
    }
  }

  if (!applyUpdate) {
    apiResponse.success(res, {
      preview: true,
      crmConfigsTotal: crmConfigs.length,
      skippedCount: skipped.length,
      skipped,
      matchedConfigs: allUpdates.length,
      totalPointsToUpdate: allUpdates.reduce((s, u) => s + u.matchedPoints.length, 0),
      updates: allUpdates,
    });
    return;
  }

  // Appliquer toutes les mises à jour
  let updatedCount = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const update of allUpdates) {
    for (const match of update.matchedPoints) {
      try {
        await prisma.pendingPoint.update({
          where: { id: match.id },
          data: { ...update.updatePayload, manuallyEdited: true },
        });
        updatedCount++;
      } catch (err) {
        errors.push({ id: match.id, error: (err as Error).message });
      }
    }
  }

  apiResponse.success(res, {
    applied: true,
    crmConfigsTotal: crmConfigs.length,
    skippedCount: skipped.length,
    skipped,
    updatedCount,
    errors,
  });
}

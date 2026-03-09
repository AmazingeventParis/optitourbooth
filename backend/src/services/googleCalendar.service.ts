import { google } from 'googleapis';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { ensureDateUTC } from '../utils/dateUtils.js';

const LIR_PREFIX = '(LIR)';

// Mapping Google Calendar colorId → nom du produit OptiTour
const COLOR_TO_PRODUIT: Record<string, string> = {
  '3': 'Ring',        // Raisin (violet)
  '4': 'Playbox',     // Flamant (rose)
  '5': 'Smakk',       // Banane (jaune)
  '6': 'Miroir',      // Mandarine (orange)
  '8': 'Vegas',       // Graphite (gris foncé)
  '9': 'Aircam',      // Myrtille (bleu foncé)
  '10': 'Spinner',    // Basilic (vert foncé)
};

function getCalendarClient() {
  if (!config.googleCalendar.serviceAccountBase64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 non configuré');
  }

  const credentials = JSON.parse(
    Buffer.from(config.googleCalendar.serviceAccountBase64, 'base64').toString('utf-8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  return google.calendar({ version: 'v3', auth });
}

export async function syncGoogleCalendarEvents(): Promise<{
  found: number;
  created: number;
  updated: number;
  errors: number;
}> {
  const calendarIds = config.googleCalendar.calendarIds;
  if (calendarIds.length === 0) {
    console.log('[Google Calendar] Aucun calendrier configuré (GOOGLE_CALENDAR_IDS), sync ignorée');
    return { found: 0, created: 0, updated: 0, errors: 0 };
  }

  const calendar = getCalendarClient();

  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const timeMax = new Date(
    now.getTime() + config.googleCalendar.syncDaysAhead * 24 * 60 * 60 * 1000
  ).toISOString();

  let allLirEvents: { event: any; calendarId: string }[] = [];

  // Récupérer les événements de chaque calendrier
  for (const calId of calendarIds) {
    try {
      const response = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 500,
      });

      const events = response.data.items || [];
      const lirEvents = events.filter(
        (e) => e.summary && e.summary.trim().toUpperCase().startsWith(LIR_PREFIX)
      );

      console.log(`[Google Calendar] ${calId}: ${lirEvents.length} (LIR) sur ${events.length} total`);
      allLirEvents.push(...lirEvents.map(event => ({ event, calendarId: calId })));
    } catch (e) {
      console.error(`[Google Calendar] Erreur lecture calendrier ${calId}:`, e);
    }
  }

  console.log(`[Google Calendar] Total: ${allLirEvents.length} événements (LIR)`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const { event } of allLirEvents) {
    const clientName = (event.summary || '').trim().substring(LIR_PREFIX.length).trim() || 'Client inconnu';
    const location = event.location || '';
    const description = event.description || '';
    const eventId = event.id || '';

    // Déterminer le produit via la couleur de l'événement
    const colorId = event.colorId || '';
    const produitNom = COLOR_TO_PRODUIT[colorId] || null;

    if (produitNom) {
      console.log(`[Google Calendar] ${clientName} → couleur ${colorId} → ${produitNom}`);
    }

    // Dates : start.date pour all-day, start.dateTime pour événements avec heure
    const startDate = event.start?.date || event.start?.dateTime?.substring(0, 10) || '';
    let endDate = event.end?.date || event.end?.dateTime?.substring(0, 10) || '';

    if (!startDate || !endDate) {
      errors++;
      continue;
    }

    // Pour les événements "all-day", Google Calendar met la date de fin au jour SUIVANT
    if (event.start?.date && event.end?.date) {
      const endDateObj = new Date(endDate + 'T12:00:00Z');
      endDateObj.setDate(endDateObj.getDate() - 1);
      endDate = endDateObj.toISOString().substring(0, 10);
    }

    const notes = description
      ? `Google Calendar: ${description}`
      : 'Import Google Calendar (LIR)';

    // Point livraison (date de début)
    try {
      await prisma.pendingPoint.upsert({
        where: { externalId: `${eventId}_livraison` },
        update: {
          date: ensureDateUTC(startDate),
          clientName,
          adresse: location,
          type: 'livraison',
          produitNom,
          notes,
        },
        create: {
          date: ensureDateUTC(startDate),
          clientName,
          adresse: location,
          type: 'livraison',
          produitNom,
          notes,
          source: 'google_calendar',
          externalId: `${eventId}_livraison`,
        },
      });
      created++;
    } catch (e) {
      console.error(`[Google Calendar] Erreur livraison ${clientName}:`, e);
      errors++;
    }

    // Point ramassage (date de fin)
    try {
      await prisma.pendingPoint.upsert({
        where: { externalId: `${eventId}_ramassage` },
        update: {
          date: ensureDateUTC(endDate),
          clientName,
          adresse: location,
          type: 'ramassage',
          produitNom,
          notes,
        },
        create: {
          date: ensureDateUTC(endDate),
          clientName,
          adresse: location,
          type: 'ramassage',
          produitNom,
          notes,
          source: 'google_calendar',
          externalId: `${eventId}_ramassage`,
        },
      });
      created++;
    } catch (e) {
      console.error(`[Google Calendar] Erreur ramassage ${clientName}:`, e);
      errors++;
    }
  }

  console.log(`[Google Calendar] Sync terminée: ${created} upserts, ${errors} erreurs`);
  return { found: lirEvents.length, created, updated, errors };
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startGoogleCalendarSync(): void {
  if (!config.googleCalendar.syncEnabled) {
    console.log('[Google Calendar] Sync désactivée (GOOGLE_CALENDAR_SYNC_ENABLED != true)');
    return;
  }

  if (!config.googleCalendar.serviceAccountBase64 || config.googleCalendar.calendarIds.length === 0) {
    console.log('[Google Calendar] Configuration incomplète, sync désactivée');
    return;
  }

  const intervalMs = config.googleCalendar.syncIntervalMinutes * 60 * 1000;

  console.log(`[Google Calendar] Démarrage sync toutes les ${config.googleCalendar.syncIntervalMinutes} minutes`);

  // Sync initiale après 10 secondes (laisser le serveur démarrer)
  setTimeout(() => {
    syncGoogleCalendarEvents().catch((e) =>
      console.error('[Google Calendar] Erreur sync initiale:', e)
    );
  }, 10_000);

  // Sync périodique
  syncInterval = setInterval(() => {
    syncGoogleCalendarEvents().catch((e) =>
      console.error('[Google Calendar] Erreur sync périodique:', e)
    );
  }, intervalMs);
}

export function stopGoogleCalendarSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Google Calendar] Sync arrêtée');
  }
}

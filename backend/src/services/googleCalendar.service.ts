import { google } from 'googleapis';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { ensureDateUTC } from '../utils/dateUtils.js';

// Regex pour matcher (LIR), (LIR PREM), (LIR SALON), (LIR MIROIR), etc.
const LIR_REGEX = /^\(LIR[^)]*\)/i;

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

// ===== PARSER DE DESCRIPTION =====

interface ParsedDescription {
  adresse: string | null;
  contactNom: string | null;
  contactTelephone: string | null;
  creneauLivraison: string | null;  // ex: "10h-14h"
  creneauRecuperation: string | null;
  notes: string;
}

// Regex pour numéros de téléphone français
const PHONE_REGEX = /(?:0[1-9])[\s.\-]?(?:\d{2}[\s.\-]?){4}/g;

// Regex pour créneaux horaires: "10h-14h", "10H00-12H00", "10h à 14h", "entre 14h et 18h"
const TIME_SLOT_REGEX = /(\d{1,2})\s*[hH]\s*(\d{0,2})\s*(?:-|à|a|et|ET|and)\s*(\d{1,2})\s*[hH]\s*(\d{0,2})/i;

// Regex pour adresse française (numéro + rue/avenue/boulevard...)
const ADDRESS_REGEX = /\d+\s*[,.]?\s*(?:rue|avenue|av\.|bd|boulevard|place|allée|chemin|impasse|passage|quai|cours|route)\s+[^\n,]+(?:,\s*\d{5}\s*[^\n,]+)?/i;

function cleanHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|span|b|i|u|strong|em|a|ul|li|ol|table|tr|td|th|thead|tbody)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseDescription(rawDescription: string): ParsedDescription {
  const text = cleanHtml(rawDescription);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let adresse: string | null = null;
  let contactNom: string | null = null;
  let contactTelephone: string | null = null;
  let creneauLivraison: string | null = null;
  let creneauRecuperation: string | null = null;
  const notesLines: string[] = [];
  const timeSlots: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineUpper = line.toUpperCase();

    // Extraction adresse avec label
    if (lineUpper.startsWith('ADRESSE') && line.includes(':')) {
      adresse = line.substring(line.indexOf(':') + 1).trim();
      continue;
    }

    // Extraction créneau livraison avec label
    if (lineUpper.startsWith('LIVRAISON') && line.includes(':')) {
      const match = line.match(TIME_SLOT_REGEX);
      if (match) {
        creneauLivraison = formatTimeSlot(match);
      }
      continue;
    }

    // Extraction créneau récupération avec label
    if ((lineUpper.startsWith('RECUP') || lineUpper.startsWith('RÉCUP')) && line.includes(':')) {
      const match = line.match(TIME_SLOT_REGEX);
      if (match) {
        creneauRecuperation = formatTimeSlot(match);
      }
      continue;
    }

    // Extraction contact avec label
    if (lineUpper.startsWith('CONTACT') && line.includes(':')) {
      const contactPart = line.substring(line.indexOf(':') + 1).trim();
      const phones = contactPart.match(PHONE_REGEX);
      if (phones) {
        contactTelephone = phones[0].replace(/[\s.\-]/g, '');
      }
      // Nom avant le téléphone
      const nameBeforePhone = contactPart.replace(PHONE_REGEX, '').replace(/[/,]/g, '').trim();
      if (nameBeforePhone && nameBeforePhone.length > 2) {
        contactNom = nameBeforePhone;
      }
      continue;
    }

    // Détection d'adresse sans label (numéro + rue)
    if (!adresse) {
      const addrMatch = line.match(ADDRESS_REGEX);
      if (addrMatch) {
        adresse = line;
        continue;
      }
    }

    // Détection de créneaux horaires dans les lignes
    const timeMatch = line.match(TIME_SLOT_REGEX);
    if (timeMatch) {
      timeSlots.push(formatTimeSlot(timeMatch));
      continue;
    }

    // Détection de numéro de téléphone (avec potentiellement un nom avant)
    const phoneMatches = line.match(PHONE_REGEX);
    if (phoneMatches && phoneMatches[0] && !contactTelephone) {
      contactTelephone = phoneMatches[0].replace(/[\s.\-]/g, '');
      // Le texte avant le téléphone est probablement le nom du contact
      const phoneIdx = line.indexOf(phoneMatches[0]);
      const beforePhone = (phoneIdx > 0 ? line.substring(0, phoneIdx) : '').replace(/[,/]/g, '').trim();
      if (beforePhone && beforePhone.length > 2 && !contactNom) {
        // Filtrer les lignes qui ne sont pas des noms (mots-clés)
        const lowerBefore = beforePhone.toLowerCase();
        if (!lowerBefore.includes('code') && !lowerBefore.includes('parking') && !lowerBefore.includes('rdc')) {
          contactNom = beforePhone;
        }
      }
      continue;
    }

    // Le reste va dans les notes
    notesLines.push(line);
  }

  // Si on a des créneaux non labelisés, le 1er = livraison, le 2nd = récupération
  if (!creneauLivraison && timeSlots.length > 0) {
    creneauLivraison = timeSlots[0] ?? null;
  }
  if (!creneauRecuperation && timeSlots.length > 1) {
    creneauRecuperation = timeSlots[1] ?? null;
  }

  return {
    adresse,
    contactNom,
    contactTelephone,
    creneauLivraison,
    creneauRecuperation,
    notes: notesLines.filter(l => l.length > 1).join(' | '),
  };
}

function formatTimeSlot(match: RegExpMatchArray): string {
  const h1 = (match[1] || '0').padStart(2, '0');
  const m1 = (match[2] || '00').padStart(2, '0');
  const h2 = (match[3] || '0').padStart(2, '0');
  const m2 = (match[4] || '00').padStart(2, '0');
  return `${h1}:${m1}-${h2}:${m2}`;
}

// ===== GOOGLE CALENDAR CLIENT =====

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

// ===== SYNC =====

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

  const allLirEvents: { event: any; calendarId: string }[] = [];

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
        (e) => e.summary && LIR_REGEX.test(e.summary.trim())
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
    const rawTitle = (event.summary || '').trim();
    const lirMatch = rawTitle.match(LIR_REGEX);
    const lirTag = lirMatch ? lirMatch[0] : '';
    const clientName = rawTitle.substring(lirTag.length).trim() || 'Client inconnu';
    const location = event.location || '';
    const description = event.description || '';
    const eventId = event.id || '';

    // Parser la description
    const parsed = description ? parseDescription(description) : null;

    // Adresse : priorité au champ location de l'événement, sinon celle de la description
    const adresse = location || parsed?.adresse || null;

    // Produit via couleur
    const colorId = event.colorId || '';
    const produitNom = COLOR_TO_PRODUIT[colorId] || null;

    if (produitNom) {
      console.log(`[Google Calendar] ${clientName} → couleur ${colorId} → ${produitNom}`);
    }

    // Dates
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

    // Créneaux : extraits de la description
    const creneauLivDebut = parsed?.creneauLivraison?.split('-')[0] || null;
    const creneauLivFin = parsed?.creneauLivraison?.split('-')[1] || null;
    const creneauRecDebut = parsed?.creneauRecuperation?.split('-')[0] || null;
    const creneauRecFin = parsed?.creneauRecuperation?.split('-')[1] || null;

    // Notes : infos restantes de la description
    const notes = parsed?.notes || (description ? `Google Calendar: ${cleanHtml(description)}` : 'Import Google Calendar (LIR)');

    // Contact
    const contactNom = parsed?.contactNom || null;
    const contactTelephone = parsed?.contactTelephone || null;

    // Point livraison (date de début)
    try {
      await prisma.pendingPoint.upsert({
        where: { externalId: `${eventId}_livraison` },
        update: {
          date: ensureDateUTC(startDate),
          clientName,
          adresse,
          type: 'livraison',
          produitNom,
          creneauDebut: creneauLivDebut,
          creneauFin: creneauLivFin,
          contactNom,
          contactTelephone,
          notes,
        },
        create: {
          date: ensureDateUTC(startDate),
          clientName,
          adresse,
          type: 'livraison',
          produitNom,
          creneauDebut: creneauLivDebut,
          creneauFin: creneauLivFin,
          contactNom,
          contactTelephone,
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
          adresse,
          type: 'ramassage',
          produitNom,
          creneauDebut: creneauRecDebut,
          creneauFin: creneauRecFin,
          contactNom,
          contactTelephone,
          notes,
        },
        create: {
          date: ensureDateUTC(endDate),
          clientName,
          adresse,
          type: 'ramassage',
          produitNom,
          creneauDebut: creneauRecDebut,
          creneauFin: creneauRecFin,
          contactNom,
          contactTelephone,
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
  return { found: allLirEvents.length, created, updated, errors };
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

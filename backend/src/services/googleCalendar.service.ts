import { google } from 'googleapis';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { ensureDateUTC } from '../utils/dateUtils.js';

// Regex pour matcher (LIR), (LIR PREM), (LIR SALON), (LIR MIROIR), etc.
const LIR_REGEX = /^\(LIR[^)]*\)/i;

// Tags LIR à ignorer (pas de points à créer)
const LIR_TAGS_IGNORED = ['TNT'];

// Mapping LIR tag → nom du produit OptiTour
// Note: colorId n'est pas accessible via service account (c'est une préférence utilisateur)
// On utilise le tag LIR et le calendrier source comme alternatives
const LIR_TAG_TO_PRODUIT: Record<string, string> = {
  'MIROIR': 'Miroir',
  'VEGAS': 'Vegas',
  'RING': 'Ring',
  'PLAYBOX': 'Playbox',
  'AIRCAM': 'Aircam',
  'SPINNER': 'Spinner',
  'SMAKK': 'Smakk',
};

// Calendrier Smakk → tous les événements sont du produit Smakk
const SMAKK_CALENDAR_ID = 'faa39fa21157c487ef3a5007739b04b69a9309cffee9d8bfc4ff09c75958bbd1@group.calendar.google.com';

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

// Regex pour adresse française (numéro + type de voie)
const STREET_TYPES = 'rue|avenue|av\\.?|bd\\.?|boulevard|place|pl\\.?|allée|all\\.?|chemin|ch\\.?|impasse|imp\\.?|passage|pass\\.?|quai|cours|route|rte\\.?|voie|square|sq\\.?|résidence|rés\\.?|cité|lot\\.?|lotissement|parvis|esplanade|promenade|rond[- ]point|carrefour|hameau|lieu[- ]dit|zone|za|zi';
const ADDRESS_REGEX = new RegExp(`\\d+\\s*[,.]?\\s*(?:${STREET_TYPES})\\s+[^\\n]+`, 'i');

// Regex pour code postal français (5 chiffres + ville)
const POSTAL_CODE_REGEX = /\d{5}\s+[A-ZÀ-Ü][a-zA-ZÀ-ü\s-]+/;

// Regex pour détecter une ligne de date française (lundi 18 mars 2026, 18/03/2026, etc.)
const DATE_LINE_REGEX = /(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}/i;

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

function isAddressLine(line: string): boolean {
  // Détection par type de voie (numéro + rue/avenue/imp./etc.)
  if (ADDRESS_REGEX.test(line)) return true;
  // Détection par code postal français (75019 Paris, 92100 Boulogne, etc.)
  if (POSTAL_CODE_REGEX.test(line)) return true;
  // Détection d'un code postal seul dans la ligne
  if (/\b\d{5}\b/.test(line) && /[A-ZÀ-Ü]/.test(line)) {
    // Vérifier que ce n'est pas un numéro de téléphone
    if (!PHONE_REGEX.test(line)) return true;
  }
  return false;
}

function isDateLine(line: string): boolean {
  return DATE_LINE_REGEX.test(line);
}

function parseDescription(rawDescription: string): ParsedDescription {
  const text = cleanHtml(rawDescription);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let adresse: string | null = null;
  const addressParts: string[] = [];
  let contactNom: string | null = null;
  let contactTelephone: string | null = null;
  let creneauLivraison: string | null = null;
  let creneauRecuperation: string | null = null;
  const notesLines: string[] = [];

  // Structure pour associer créneaux aux dates
  const dateTimeSlots: Array<{ date: string | null; slot: string }> = [];
  let lastDateLine: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineUpper = line.toUpperCase();

    // === LABELS EXPLICITES (prioritaires) ===

    // Adresse avec label
    if (lineUpper.startsWith('ADRESSE') && line.includes(':')) {
      adresse = line.substring(line.indexOf(':') + 1).trim();
      continue;
    }

    // Créneau livraison avec label
    if ((lineUpper.startsWith('LIVRAISON') || lineUpper.startsWith('LIV')) && line.includes(':')) {
      const match = line.match(TIME_SLOT_REGEX);
      if (match) creneauLivraison = formatTimeSlot(match);
      continue;
    }

    // Créneau récupération avec label
    if ((lineUpper.startsWith('RECUP') || lineUpper.startsWith('RÉCUP') || lineUpper.startsWith('RAMASSAGE')) && line.includes(':')) {
      const match = line.match(TIME_SLOT_REGEX);
      if (match) creneauRecuperation = formatTimeSlot(match);
      continue;
    }

    // Contact avec label
    if (lineUpper.startsWith('CONTACT') && line.includes(':')) {
      const contactPart = line.substring(line.indexOf(':') + 1).trim();
      extractContact(contactPart);
      continue;
    }

    // === DÉTECTION AUTOMATIQUE ===

    // Ligne de date (Mercredi 18 mars 2026, 18/03/2026, etc.)
    if (isDateLine(line)) {
      lastDateLine = line;
      continue;
    }

    // Créneau horaire
    const timeMatch = line.match(TIME_SLOT_REGEX);
    if (timeMatch) {
      dateTimeSlots.push({ date: lastDateLine, slot: formatTimeSlot(timeMatch) });
      lastDateLine = null;
      continue;
    }

    // Numéro de téléphone (avec potentiellement un nom avant)
    const phoneMatches = line.match(PHONE_REGEX);
    if (phoneMatches && phoneMatches[0] && !contactTelephone) {
      extractContact(line);
      continue;
    }

    // Adresse (par type de voie ou code postal)
    if (!adresse && isAddressLine(line)) {
      // Si la ligne précédente ressemble à un nom de lieu (pas un créneau, pas une date, pas un téléphone)
      // l'inclure comme complément d'adresse (ex: "restaurant CHEZ ERNEST" avant "4 Imp. de Joinville")
      if (notesLines.length > 0) {
        const prevNote = notesLines[notesLines.length - 1];
        if (prevNote && !isDateLine(prevNote) && !TIME_SLOT_REGEX.test(prevNote) && !PHONE_REGEX.test(prevNote) && prevNote.length < 60) {
          addressParts.push(notesLines.pop()!);
        }
      }
      addressParts.push(line);
      // Regarder si la ligne suivante complète l'adresse (code postal sur ligne séparée)
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!.trim();
        if (/^\d{5}\s/.test(nextLine) && !addressParts.some(p => /\d{5}/.test(p))) {
          addressParts.push(nextLine);
          i++;
        }
      }
      continue;
    }

    // Ligne avec code postal qui pourrait compléter l'adresse
    if (addressParts.length > 0 && !adresse && /^\d{5}\s/.test(line)) {
      addressParts.push(line);
      continue;
    }

    // Le reste va dans les notes
    notesLines.push(line);
  }

  // Assembler l'adresse
  if (!adresse && addressParts.length > 0) {
    adresse = addressParts.join(', ');
  }

  // Associer les créneaux aux types livraison/récupération
  if (dateTimeSlots.length > 0) {
    if (!creneauLivraison) {
      creneauLivraison = dateTimeSlots[0]?.slot ?? null;
    }
    if (!creneauRecuperation && dateTimeSlots.length > 1) {
      creneauRecuperation = dateTimeSlots[1]?.slot ?? null;
    }
  }

  return {
    adresse,
    contactNom,
    contactTelephone,
    creneauLivraison,
    creneauRecuperation,
    notes: notesLines.filter(l => l.length > 1).join(' | '),
  };

  function extractContact(text: string) {
    const phones = text.match(PHONE_REGEX);
    if (phones && phones[0]) {
      contactTelephone = phones[0].replace(/[\s.\-]/g, '');
    }
    // Nom = texte avant le téléphone (sans ponctuation parasite)
    const nameText = text.replace(PHONE_REGEX, '').replace(/[/,;:]/g, '').trim();
    if (nameText && nameText.length > 2 && !contactNom) {
      const lower = nameText.toLowerCase();
      // Filtrer les mots-clés qui ne sont pas des noms
      if (!lower.includes('code') && !lower.includes('parking') && !lower.includes('rdc') && !lower.includes('digicode')) {
        contactNom = nameText;
      }
    }
  }
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

  // Charger tous les points existants dans des tournées pour la période concernée
  // afin de ne pas créer de pending points pour des événements déjà programmés
  const existingTourneePoints = await prisma.point.findMany({
    where: {
      tournee: {
        date: {
          gte: new Date(timeMin),
          lte: new Date(timeMax),
        },
        statut: { not: 'annulee' },
      },
    },
    include: {
      client: { select: { nom: true, societe: true } },
      tournee: { select: { date: true } },
    },
  });

  // Créer un Set pour lookup rapide : "date|clientName|type" (en lowercase)
  const existingPointsSet = new Set<string>();
  for (const pt of existingTourneePoints) {
    const dateStr = pt.tournee.date.toISOString().substring(0, 10);
    const clientNom = (pt.client.societe || pt.client.nom || '').toLowerCase().trim();
    existingPointsSet.add(`${dateStr}|${clientNom}|${pt.type}`);
    // Ajouter aussi juste par date + client (sans type) pour un matching plus large
    existingPointsSet.add(`${dateStr}|${clientNom}`);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const { event, calendarId } of allLirEvents) {
    const rawTitle = (event.summary || '').trim();
    const lirMatch = rawTitle.match(LIR_REGEX);
    const lirTag = lirMatch ? lirMatch[0] : '';
    const clientName = rawTitle.substring(lirTag.length).trim() || 'Client inconnu';

    // Vérifier si le tag LIR est dans la liste des tags ignorés
    const tagContent = lirTag.replace(/^\(LIR\s*/i, '').replace(/\)$/, '').trim().toUpperCase();
    if (LIR_TAGS_IGNORED.includes(tagContent)) {
      // Supprimer les points déjà créés pour cet événement ignoré
      const eventId = event.id || '';
      if (eventId) {
        const deleted = await prisma.pendingPoint.deleteMany({
          where: { externalId: { startsWith: eventId } },
        });
        if (deleted.count > 0) {
          console.log(`[Google Calendar] 🗑️ ${deleted.count} point(s) supprimé(s) pour événement ignoré (${tagContent}): ${clientName}`);
        }
      }
      continue;
    }

    const location = event.location || '';
    const description = event.description || '';
    const eventId = event.id || '';

    // Parser la description
    const parsed = description ? parseDescription(description) : null;

    // Adresse : priorité au champ location de l'événement, sinon celle de la description
    const adresse = location || parsed?.adresse || null;

    // Produit : détection par tag LIR (prioritaire) et calendrier source (fallback)
    let produitNom: string | null = null;

    // 1. Extraire le mot-clé du tag LIR: "(LIR MIROIR)" → "MIROIR"
    if (tagContent && LIR_TAG_TO_PRODUIT[tagContent]) {
      produitNom = LIR_TAG_TO_PRODUIT[tagContent];
    }

    // 2. Fallback : calendrier Smakk → produit Smakk
    if (!produitNom && calendarId === SMAKK_CALENDAR_ID) {
      produitNom = 'Smakk';
    }

    console.log(`[Google Calendar] ${clientName} → tag="${lirTag}" cal="${calendarId === SMAKK_CALENDAR_ID ? 'smakk' : 'main'}" → ${produitNom || 'aucun produit'}`);


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

    // Vérifier si ce client a déjà un point livraison à cette date dans une tournée
    const clientNameLower = clientName.toLowerCase().trim();
    const livAlreadyInTournee = existingPointsSet.has(`${startDate}|${clientNameLower}|livraison`)
      || existingPointsSet.has(`${startDate}|${clientNameLower}`);

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
          calendarId,
          dispatched: livAlreadyInTournee ? true : undefined,
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
          calendarId,
          externalId: `${eventId}_livraison`,
          dispatched: livAlreadyInTournee,
        },
      });
      if (livAlreadyInTournee) {
        skipped++;
        console.log(`[Google Calendar] ${clientName} livraison ${startDate} → déjà dans tournée, skip`);
      } else {
        created++;
      }
    } catch (e) {
      console.error(`[Google Calendar] Erreur livraison ${clientName}:`, e);
      errors++;
    }

    // Vérifier si ce client a déjà un point ramassage à cette date dans une tournée
    const recAlreadyInTournee = existingPointsSet.has(`${endDate}|${clientNameLower}|ramassage`)
      || existingPointsSet.has(`${endDate}|${clientNameLower}`);

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
          calendarId,
          dispatched: recAlreadyInTournee ? true : undefined,
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
          calendarId,
          externalId: `${eventId}_ramassage`,
          dispatched: recAlreadyInTournee,
        },
      });
      if (recAlreadyInTournee) {
        skipped++;
        console.log(`[Google Calendar] ${clientName} ramassage ${endDate} → déjà dans tournée, skip`);
      } else {
        created++;
      }
    } catch (e) {
      console.error(`[Google Calendar] Erreur ramassage ${clientName}:`, e);
      errors++;
    }
  }

  console.log(`[Google Calendar] Sync terminée: ${created} créés, ${skipped} déjà en tournée, ${errors} erreurs`);
  return { found: allLirEvents.length, created, updated: skipped, errors };
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

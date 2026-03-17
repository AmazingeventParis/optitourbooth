import { google } from 'googleapis';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { ensureDateUTC } from '../utils/dateUtils.js';
import { isDriveConfigured } from './googleDrive.service.js';

// Regex pour matcher tout événement dont le titre commence par une parenthèse
// (LIR), (LIR MIROIR), (R VEGAS newww), (L RING), (SMAKK), () etc.
const EVENT_TAG_REGEX = /^\([^)]*\)/;

// Ancien format LIR uniquement (pour compatibilité dans l'extraction du contenu)
const LIR_PREFIX_REGEX = /^\(LIR\s*/i;

// Tags à ignorer (pas de points à créer)
const TAGS_IGNORED = ['TNT', 'SLIM'];

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
  creneauLivraison: string | null;  // ex: "10:00-17:00"
  creneauRecuperation: string | null;
  notes: string;
}

// === REGEX ===

// Téléphone français : 06 12 34 56 78, 06.12.34.56.78, 0612345678, +33 6 12 34 56 78
const PHONE_REGEX = /(?:\+33\s?[1-9]|0[1-9])[\s.\-]?(?:\d{2}[\s.\-]?){4}/g;

// Créneau horaire : "10h-17h", "10H00-12H00", "10h à 14h", "entre 14h et 18h",
// "10:00-14:00", "de 9h30 à 11h", "9h - 12h", "10h>14h"
const TIME_SLOT_REGEX = /(\d{1,2})\s*[hH:]\s*(\d{0,2})\s*(?:-|–|—|à|a|et|>)\s*(\d{1,2})\s*[hH:]\s*(\d{0,2})/i;

// Heure simple : "10h", "14h30", "9H00" (sans plage, pour cas isolés)
const SINGLE_TIME_REGEX = /\b(\d{1,2})\s*[hH:]\s*(\d{0,2})\b/;

// Types de voies françaises (exhaustif)
const STREET_TYPES = 'rue|avenue|av\\.?|bd\\.?|boulevard|place|pl\\.?|allée|all\\.?|chemin|ch\\.?|impasse|imp\\.?|passage|pass\\.?|quai|cours|route|rte\\.?|voie|square|sq\\.?|résidence|rés\\.?|cité|lot\\.?|lotissement|parvis|esplanade|promenade|rond[- ]?point|carrefour|hameau|lieu[- ]?dit|zone|za|zi|sentier|sente|villa|cour|galerie|mail|terre[- ]?plein|montée|rampe|traverse|ruelle|venelle|drève|chemin de|faubourg|fg\\.?';
const ADDRESS_REGEX = new RegExp(`\\d+\\s*[,.]?\\s*(?:${STREET_TYPES})\\b`, 'i');

// Code postal français : 75002 PARIS, 92100 Boulogne-Billancourt
const POSTAL_CODE_REGEX = /\b\d{5}\s+[A-ZÀ-Ü][a-zA-ZÀ-ü\s-]+/;

// Date française longue : "Vendredi 13 mars 2026", "lundi 5 janvier 2025", "Le 20 mars 2026", "Le 21 mars"
const MONTH_NAMES = 'janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre';
const DATE_FR_LONG = new RegExp(
  `(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|le)\\s+)?\\d{1,2}\\s+(?:${MONTH_NAMES})(?:\\s+\\d{4})?`,
  'i'
);

// Date numérique : "18/03/2026", "18.03.2026", "18-03-2026", "2026-03-18"
const DATE_NUMERIC = /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b|\b\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}\b/;

// Mots-clés livraison
const LIVRAISON_KEYWORDS = /\b(?:livraison|liv\.?|installation|install\.?|mise\s+en\s+place|montage|livrer)\b/i;

// Mots-clés récupération
const RECUPERATION_KEYWORDS = /\b(?:r[ée]cup[ée]?ration|r[ée]cup\.?|ramassage|d[ée]montage|retrait|enlèvement|r[ée]cup[ée]?rer|reprendre)\b/i;

// Mots-clés de labels à ignorer (pas des noms de contacts)
const NOT_CONTACT_KEYWORDS = /\b(?:code|parking|rdc|digicode|interphone|badge|portail|barrière|accès|étage|bâtiment|bat|porte|escalier|ascenseur|entrée|sortie|livraison|récup|ramassage|adresse|horaire|créneau|rdv|rendez.vous)\b/i;

// === FONCTIONS UTILITAIRES ===

function cleanHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|span|b|i|u|strong|em|a|ul|li|ol|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|hr|img|figure|figcaption)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // HTML entities → characters
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Numeric HTML entities (&#160; &#x00A0; etc.) → convert to char, not delete
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Remove any remaining named HTML entities
    .replace(/&\w+;/g, ' ')
    // Unicode whitespace normalization (NBSP, zero-width spaces, etc.)
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ')
    .trim();
}

// Normaliser les espaces multiples, tabulations, et tout type de whitespace
function normalizeSpaces(text: string): string {
  return text.replace(/[\s]+/g, ' ').trim();
}

function containsDate(line: string): boolean {
  if (DATE_FR_LONG.test(line)) return true;
  if (DATE_NUMERIC.test(line)) return true;
  // "Le 20 mars", "20 mars" without year (already covered by updated DATE_FR_LONG)
  return false;
}

function containsTimeSlot(line: string): boolean {
  return TIME_SLOT_REGEX.test(line);
}

function containsPhone(line: string): boolean {
  PHONE_REGEX.lastIndex = 0;
  return PHONE_REGEX.test(line);
}

function isAddressLine(line: string): boolean {
  // Détection par type de voie (numéro + rue/avenue/imp./etc.)
  if (ADDRESS_REGEX.test(line)) return true;
  // Code postal + ville (75019 Paris, 92100 Boulogne)
  if (POSTAL_CODE_REGEX.test(line)) return true;
  // Code postal seul avec un nom de ville (pas un téléphone)
  if (/\b\d{5}\b/.test(line) && /[A-ZÀ-Ü]/.test(line) && !containsPhone(line) && !containsDate(line)) {
    return true;
  }
  return false;
}

function isPostalCodeLine(line: string): boolean {
  return /^\d{5}\s+[A-ZÀ-Üa-zà-ü]/.test(line) && !containsPhone(line);
}

function extractTimeSlotFromLine(line: string): string | null {
  const match = line.match(TIME_SLOT_REGEX);
  return match ? formatTimeSlot(match) : null;
}

function parseDescription(rawDescription: string): ParsedDescription {
  const text = cleanHtml(rawDescription);
  const lines = text.split('\n').map(l => normalizeSpaces(l)).filter(l => l.length > 0);

  let adresse: string | null = null;
  const addressParts: string[] = [];
  let contactNom: string | null = null;
  let contactTelephone: string | null = null;
  let creneauLivraison: string | null = null;
  let creneauRecuperation: string | null = null;
  const notesLines: string[] = [];

  // Créneaux collectés avec contexte (date ou mot-clé associé)
  const collectedSlots: Array<{ slot: string; context: 'livraison' | 'recuperation' | 'unknown' }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineUpper = line.toUpperCase();

    // === 1. LABELS EXPLICITES (prioritaires) ===

    // "Adresse : ..."
    if (/^ADRESSE\s*[:=]/i.test(line)) {
      adresse = line.replace(/^ADRESSE\s*[:=]\s*/i, '').trim();
      continue;
    }

    // "Livraison : 10h-17h" ou "Livraison le 13 mars 10h-17h"
    if (LIVRAISON_KEYWORDS.test(line)) {
      const slot = extractTimeSlotFromLine(line);
      if (slot) {
        creneauLivraison = slot;
        continue;
      }
      // No time slot on this line — check the next line
      if (i + 1 < lines.length) {
        const nextSlot = extractTimeSlotFromLine(lines[i + 1]!);
        if (nextSlot) {
          creneauLivraison = nextSlot;
          i++; // skip next line
          continue;
        }
      }
    }

    // "Récupération : 10h-17h" ou "Ramassage 14h-18h"
    if (RECUPERATION_KEYWORDS.test(line)) {
      const slot = extractTimeSlotFromLine(line);
      if (slot) {
        creneauRecuperation = slot;
        continue;
      }
      // No time slot on this line — check the next line
      if (i + 1 < lines.length) {
        const nextSlot = extractTimeSlotFromLine(lines[i + 1]!);
        if (nextSlot) {
          creneauRecuperation = nextSlot;
          i++; // skip next line
          continue;
        }
      }
    }

    // "Contact : Nom 06..."
    if (/^CONTACT\s*[:=]/i.test(line)) {
      extractContact(line.replace(/^CONTACT\s*[:=]\s*/i, ''));
      continue;
    }

    // === 2. LIGNES COMBINÉES DATE+CRÉNEAU ===
    // Ex: "Vendredi 13 mars 2026- 10h-17h", "13/03/2026 10h-17h"
    if (containsDate(line) && containsTimeSlot(line)) {
      const slot = extractTimeSlotFromLine(line);
      if (slot) {
        // Déterminer le contexte par mots-clés sur la même ligne
        let context: 'livraison' | 'recuperation' | 'unknown' = 'unknown';
        if (LIVRAISON_KEYWORDS.test(line)) context = 'livraison';
        else if (RECUPERATION_KEYWORDS.test(line)) context = 'recuperation';
        collectedSlots.push({ slot, context });
      }
      continue;
    }

    // === 3. LIGNE DE DATE SEULE (garder en mémoire pour la ligne suivante) ===
    if (containsDate(line) && !containsTimeSlot(line) && !isAddressLine(line)) {
      // Vérifier si la ligne suivante contient un créneau
      if (i + 1 < lines.length && containsTimeSlot(lines[i + 1]!)) {
        const nextLine = normalizeSpaces(lines[i + 1]!);
        const slot = extractTimeSlotFromLine(nextLine);
        if (slot) {
          let context: 'livraison' | 'recuperation' | 'unknown' = 'unknown';
          if (LIVRAISON_KEYWORDS.test(line) || LIVRAISON_KEYWORDS.test(nextLine)) context = 'livraison';
          else if (RECUPERATION_KEYWORDS.test(line) || RECUPERATION_KEYWORDS.test(nextLine)) context = 'recuperation';
          collectedSlots.push({ slot, context });
          i++; // Skip la ligne suivante (créneau déjà traité)
        }
      }
      continue;
    }

    // === 4. CRÉNEAU HORAIRE SEUL ===
    if (containsTimeSlot(line) && !isAddressLine(line)) {
      const slot = extractTimeSlotFromLine(line);
      if (slot) {
        let context: 'livraison' | 'recuperation' | 'unknown' = 'unknown';
        if (LIVRAISON_KEYWORDS.test(line)) context = 'livraison';
        else if (RECUPERATION_KEYWORDS.test(line)) context = 'recuperation';
        collectedSlots.push({ slot, context });
      }
      continue;
    }

    // === 5. TÉLÉPHONE (+ potentiellement nom du contact) ===
    if (containsPhone(line) && !isAddressLine(line)) {
      extractContact(line);
      continue;
    }

    // === 6. ADRESSE ===
    if (!adresse && isAddressLine(line)) {
      addressParts.push(line);
      // Absorber les lignes suivantes qui complètent l'adresse
      while (i + 1 < lines.length) {
        const nextLine = normalizeSpaces(lines[i + 1]!);
        if (isPostalCodeLine(nextLine) && !addressParts.some(p => /\d{5}/.test(p))) {
          addressParts.push(nextLine);
          i++;
        } else if (isAddressLine(nextLine) && !containsDate(nextLine) && !containsPhone(nextLine)) {
          addressParts.push(nextLine);
          i++;
        } else {
          break;
        }
      }
      continue;
    }

    // === 7. CODE POSTAL SEUL (complément d'adresse) ===
    if (isPostalCodeLine(line) && addressParts.length > 0 && !addressParts.some(p => /\d{5}/.test(p))) {
      addressParts.push(line);
      continue;
    }

    // === 8. LE RESTE → NOTES ===
    notesLines.push(line);
  }

  // === ASSEMBLAGE ADRESSE ===
  if (!adresse && addressParts.length > 0) {
    // Joindre les parties et extraire seulement la partie géocodable
    const raw = addressParts.join(', ');
    // Chercher numéro + voie
    const streetMatch = raw.match(new RegExp(`(\\d+\\s*[,.]?\\s*(?:${STREET_TYPES})\\b[^,]*)`, 'i'));
    if (streetMatch) {
      adresse = normalizeSpaces(streetMatch[1]!);
      // Ajouter le code postal + ville s'il est dans une autre partie
      if (!/\d{5}/.test(adresse)) {
        const postalMatch = raw.match(/(\d{5}\s+[A-ZÀ-Üa-zà-ü][a-zA-ZÀ-ü\s-]*)/);
        if (postalMatch) adresse += ', ' + normalizeSpaces(postalMatch[1]!);
      }
    } else {
      // Pas de numéro+voie trouvé, utiliser le code postal + ville comme adresse
      const postalMatch = raw.match(/(\d{5}\s+[A-ZÀ-Üa-zà-ü][a-zA-ZÀ-ü\s-]*)/);
      adresse = postalMatch ? normalizeSpaces(postalMatch[1]!) : normalizeSpaces(raw);
    }
  }
  // Normaliser l'adresse finale
  if (adresse) adresse = normalizeSpaces(adresse);

  // === ATTRIBUTION DES CRÉNEAUX ===
  // 1. Créneaux avec contexte explicite (mot-clé livraison/récup)
  for (const cs of collectedSlots) {
    if (cs.context === 'livraison' && !creneauLivraison) creneauLivraison = cs.slot;
    if (cs.context === 'recuperation' && !creneauRecuperation) creneauRecuperation = cs.slot;
  }
  // 2. Créneaux sans contexte → 1er = livraison, 2e = récupération
  const unknownSlots = collectedSlots.filter(cs => cs.context === 'unknown');
  if (!creneauLivraison && unknownSlots.length > 0) creneauLivraison = unknownSlots[0]!.slot;
  if (!creneauRecuperation && unknownSlots.length > 1) creneauRecuperation = unknownSlots[1]!.slot;

  // === CONTACT : dernier recours dans les notes ===
  if (!contactTelephone) {
    for (const note of notesLines) {
      if (containsPhone(note)) {
        extractContact(note);
        break;
      }
    }
  }

  const result = {
    adresse,
    contactNom: contactNom ? normalizeSpaces(contactNom) : null,
    contactTelephone,
    creneauLivraison,
    creneauRecuperation,
    notes: notesLines.filter(l => l.length > 1 && l !== contactNom).join(' | '),
  };

  console.log(`[ParseDescription] Lines: ${JSON.stringify(lines)}`);
  console.log(`[ParseDescription] Result: contact=${result.contactNom}, tel=${result.contactTelephone}, addr=${result.adresse}, liv=${result.creneauLivraison}, rec=${result.creneauRecuperation}`);

  return result;

  function extractContact(text: string) {
    // Reset le regex (flag g = stateful)
    PHONE_REGEX.lastIndex = 0;
    const phones = text.match(PHONE_REGEX);
    if (phones && phones[0] && !contactTelephone) {
      contactTelephone = phones[0].replace(/[\s.\-]/g, '');
    }
    // Nom = texte sans téléphone, sans ponctuation parasite
    PHONE_REGEX.lastIndex = 0;
    const nameText = text.replace(PHONE_REGEX, '').replace(/[/,;:()]/g, '').trim();
    if (nameText && nameText.length > 2 && !contactNom) {
      // Filtrer les mots-clés qui ne sont pas des noms de personnes
      if (!NOT_CONTACT_KEYWORDS.test(nameText)) {
        contactNom = normalizeSpaces(nameText);
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

// ===== DRIVE CLIENT (for attachment downloads) =====

function getDriveClient() {
  if (!config.googleCalendar.serviceAccountBase64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 non configuré');
  }
  const credentials = JSON.parse(
    Buffer.from(config.googleCalendar.serviceAccountBase64, 'base64').toString('utf-8')
  );
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

// Uploads directory for locally cached attachments
const ATTACHMENTS_DIR = path.join(process.cwd(), 'uploads', 'attachments');

/**
 * Download a Google Drive file to local disk if not already cached.
 * Returns the local path on success, or null on failure.
 */
async function downloadAttachmentLocally(fileId: string, title: string): Promise<string | null> {
  // Determine file extension from title
  const ext = path.extname(title) || '';
  const localFileName = `${fileId}${ext}`;
  const localPath = path.join(ATTACHMENTS_DIR, localFileName);

  // Skip if already exists
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  try {
    // Ensure directory exists
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    const drive = getDriveClient();

    // Check if it's a Google Doc type (need to export)
    const meta = await drive.files.get({ fileId, fields: 'mimeType' });
    const mimeType = meta.data.mimeType || '';
    const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.');

    let fileStream: NodeJS.ReadableStream;
    let finalPath = localPath;

    if (isGoogleDoc) {
      // Export as PDF
      const exportRes = await drive.files.export(
        { fileId, mimeType: 'application/pdf' },
        { responseType: 'stream' }
      );
      fileStream = exportRes.data as any;
      finalPath = path.join(ATTACHMENTS_DIR, `${fileId}.pdf`);
    } else {
      const downloadRes = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      fileStream = downloadRes.data as any;
    }

    // Write to disk
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(finalPath);
      fileStream.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    console.log(`[Google Calendar] 📥 Attachment downloaded: ${title} → ${finalPath}`);
    return finalPath;
  } catch (e: any) {
    console.warn(`[Google Calendar] ⚠ Failed to download attachment ${fileId} (${title}): ${e.message || e}`);
    return null;
  }
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

  const allTaggedEvents: { event: any; calendarId: string }[] = [];

  for (const calId of calendarIds) {
    try {
      const response = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 500,
        supportsAttachments: true,
      } as any);

      const events = response.data.items || [];
      const taggedEvents = events.filter(
        (e) => e.summary && EVENT_TAG_REGEX.test(e.summary.trim())
      );

      // Log les pièces jointes trouvées
      let eventsWithAttachments = 0;
      for (const ev of taggedEvents) {
        if (ev.attachments && ev.attachments.length > 0) {
          eventsWithAttachments++;
          console.log(`[Google Calendar] 📎 "${ev.summary}" a ${ev.attachments.length} pièce(s) jointe(s):`);
          for (const att of ev.attachments) {
            console.log(`  - ${att.title || att.fileId} (${att.mimeType}) → ${att.fileUrl}`);
          }
        }
      }
      if (eventsWithAttachments === 0 && taggedEvents.length > 0) {
        // Debug: log raw event keys to check if attachments field exists
        const sample = taggedEvents[0];
        console.log(`[Google Calendar] ⚠ Aucune PJ trouvée. Clés événement sample: ${Object.keys(sample!).join(', ')}`);
        console.log(`[Google Calendar] ⚠ Sample attachments field: ${JSON.stringify((sample as any)?.attachments)}`);
      }

      console.log(`[Google Calendar] ${calId}: ${taggedEvents.length} événements taggés sur ${events.length} total`);
      allTaggedEvents.push(...taggedEvents.map(event => ({ event, calendarId: calId })));
    } catch (e) {
      console.error(`[Google Calendar] Erreur lecture calendrier ${calId}:`, e);
    }
  }

  console.log(`[Google Calendar] Total: ${allTaggedEvents.length} événements taggés`);

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

  for (const { event, calendarId } of allTaggedEvents) {
    const rawTitle = (event.summary || '').trim();
    const tagMatch = rawTitle.match(EVENT_TAG_REGEX);
    const fullTag = tagMatch ? tagMatch[0] : '';
    const clientName = rawTitle.substring(fullTag.length).trim() || 'Client inconnu';

    // Extraire le contenu du tag : "(LIR MIROIR)" → "MIROIR", "(R VEGAS newww)" → "R VEGAS NEWWW"
    const tagInner = fullTag.replace(/^\(/, '').replace(/\)$/, '').trim().toUpperCase();
    // Enlever le préfixe LIR/L/R/LR s'il est seul au début pour extraire le nom produit
    const tagContent = tagInner.replace(/^(?:LIR|LR|L|R)\s+/i, '').trim();

    // (LIR...) = livraison → visible dans points à dispatcher
    // Autres tags = retrait/autre → visible uniquement dans préparations et galeries
    const isLivraison = /^LIR\b/i.test(tagInner);

    // Vérifier si le tag est dans la liste des tags ignorés (ex: TNT, LIR TNT, LIV TNT)
    const tagWords = tagInner.split(/\s+/);
    if (TAGS_IGNORED.some(ignored => tagWords.includes(ignored)) || TAGS_IGNORED.includes(tagContent)) {
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

    // Produit : détection par tag (prioritaire) et calendrier source (fallback)
    let produitNom: string | null = null;

    // 1. Chercher le nom de produit dans le tag
    // Essai exact d'abord: "(LIR MIROIR)" → tagContent="MIROIR" → match
    // Puis premier mot: "(R VEGAS newww)" → tagContent="VEGAS NEWWW" → premier mot "VEGAS" → match
    if (tagContent && LIR_TAG_TO_PRODUIT[tagContent]) {
      produitNom = LIR_TAG_TO_PRODUIT[tagContent];
    } else {
      // Chercher chaque mot du tag dans le mapping
      const tagWords = tagContent.split(/\s+/);
      for (const word of tagWords) {
        if (word && LIR_TAG_TO_PRODUIT[word]) {
          produitNom = LIR_TAG_TO_PRODUIT[word];
          break;
        }
      }
    }

    // 2. Fallback : chercher dans les noms des pièces jointes (contrats clients)
    if (!produitNom && event.attachments && event.attachments.length > 0) {
      for (const att of event.attachments) {
        const fileName = (att.title || '').toUpperCase();
        for (const [key, value] of Object.entries(LIR_TAG_TO_PRODUIT)) {
          if (fileName.includes(key)) {
            produitNom = value;
            console.log(`[Google Calendar] 📎 Produit "${value}" détecté depuis pièce jointe "${att.title}" pour ${clientName}`);
            break;
          }
        }
        if (produitNom) break;
      }
    }

    // 3. Fallback : calendrier Smakk → produit Smakk
    if (!produitNom && calendarId === SMAKK_CALENDAR_ID) {
      produitNom = 'Smakk';
    }

    console.log(`[Google Calendar] ${clientName} → tag="${fullTag}" produit="${tagContent}" cal="${calendarId === SMAKK_CALENDAR_ID ? 'smakk' : 'main'}" attachments=${event.attachments?.length || 0} → ${produitNom || 'aucun produit'}`);


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

    // Pièces jointes Google Calendar — download locally if possible
    const attachments = [];
    for (const att of (event.attachments || [])) {
      const fileId = att.fileId || null;
      const title = att.title || 'Sans titre';
      let localPath: string | null = null;

      if (fileId) {
        localPath = await downloadAttachmentLocally(fileId, title);
      }

      attachments.push({
        fileId,
        title,
        mimeType: att.mimeType || 'application/octet-stream',
        iconLink: att.iconLink || null,
        fileUrl: att.fileUrl || null,
        ...(localPath ? { localPath } : {}),
      });
    }

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
          attachments,
          ...(!isLivraison && { dispatched: true }),
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
          attachments,
          dispatched: !isLivraison || livAlreadyInTournee,
        },
      });
      if (!isLivraison) {
        console.log(`[Google Calendar] ${clientName} ${startDate} → non-LIR (${tagInner}), visible prépa/galeries uniquement`);
        created++;
      } else if (livAlreadyInTournee) {
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
          attachments,
          ...(!isLivraison && { dispatched: true }),
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
          attachments,
          dispatched: !isLivraison || recAlreadyInTournee,
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

    // Auto-create Google Drive folder + Booking for this event
    if (isDriveConfigured() && eventId) {
      try {
        const existingBooking = await prisma.booking.findUnique({
          where: { googleEventId: eventId },
        });

        if (!existingBooking) {
          const publicToken = crypto.randomBytes(24).toString('base64url');
          await prisma.booking.create({
            data: {
              publicToken,
              customerName: clientName,
              customerPhone: contactTelephone || null,
              eventDate: ensureDateUTC(startDate),
              eventEndDate: ensureDateUTC(endDate),
              produitNom: produitNom || null,
              googleEventId: eventId,
              googleReviewUrl: config.googleBusiness.defaultReviewUrl || null,
              status: 'link_sent',
            },
          });
          console.log(`[Google Calendar] Booking créé pour "${clientName}" (dossier Drive sera matché par scan)`);
        } else {
          // Booking exists — update missing info (contact)
          const bookingUpdate: Record<string, any> = {};
          if (contactTelephone && !existingBooking.customerPhone) {
            bookingUpdate.customerPhone = contactTelephone;
          }
          if (Object.keys(bookingUpdate).length > 0) {
            await prisma.booking.update({
              where: { id: existingBooking.id },
              data: bookingUpdate,
            });
          }
        }
      } catch (e) {
        console.error(`[Google Calendar] Erreur création dossier Drive pour ${clientName}:`, e);
      }
    }
  }

  // === PROPAGATION : mettre à jour les Clients liés aux points déjà dispatchés ===
  // Quand un PendingPoint est mis à jour avec de nouvelles infos contact,
  // les Clients déjà liés (via Points de tournée) doivent aussi être mis à jour
  try {
    const pendingPointsWithContacts = await prisma.pendingPoint.findMany({
      where: {
        source: 'google_calendar',
        OR: [
          { contactNom: { not: null } },
          { contactTelephone: { not: null } },
        ],
      },
      select: {
        clientName: true,
        contactNom: true,
        contactTelephone: true,
      },
    });

    let contactsUpdated = 0;
    for (const pp of pendingPointsWithContacts) {
      if (!pp.contactNom && !pp.contactTelephone) continue;

      // Find clients by name (case-insensitive) that are missing contact info
      const matchingClients = await prisma.client.findMany({
        where: {
          OR: [
            { nom: { equals: pp.clientName, mode: 'insensitive' } },
            { societe: { equals: pp.clientName, mode: 'insensitive' } },
          ],
          AND: [
            {
              OR: [
                { contactNom: null },
                { contactNom: '' },
                { contactTelephone: null },
                { contactTelephone: '' },
              ],
            },
          ],
        },
      });

      for (const client of matchingClients) {
        const updateData: Record<string, string> = {};
        if (pp.contactNom && !client.contactNom) updateData.contactNom = pp.contactNom;
        if (pp.contactTelephone && !client.contactTelephone) updateData.contactTelephone = pp.contactTelephone;

        if (Object.keys(updateData).length > 0) {
          await prisma.client.update({
            where: { id: client.id },
            data: updateData,
          });
          contactsUpdated++;
          console.log(`[Google Calendar] 📇 Contact mis à jour pour client "${client.nom || client.societe}": ${JSON.stringify(updateData)}`);
        }
      }
    }

    if (contactsUpdated > 0) {
      console.log(`[Google Calendar] ${contactsUpdated} client(s) mis à jour avec infos contact`);
    }
  } catch (e) {
    console.error('[Google Calendar] Erreur propagation contacts:', e);
  }

  // === PROPAGATION PIÈCES JOINTES : mettre à jour les Points de tournées existants ===
  try {
    const pendingWithAttachments = await prisma.pendingPoint.findMany({
      where: {
        source: 'google_calendar',
        dispatched: true,
        NOT: { attachments: { equals: [] } },
      },
      select: {
        clientName: true,
        date: true,
        type: true,
        attachments: true,
      },
    });

    let attachmentsUpdated = 0;
    for (const pp of pendingWithAttachments) {
      const atts = pp.attachments as any[];
      if (!atts || atts.length === 0) continue;

      // Trouver les Points correspondants (même client, même date, même type) sans pièces jointes
      const matchingPoints = await prisma.point.findMany({
        where: {
          client: {
            OR: [
              { nom: { equals: pp.clientName, mode: 'insensitive' } },
              { societe: { equals: pp.clientName, mode: 'insensitive' } },
            ],
          },
          tournee: { date: pp.date },
          type: pp.type as any,
          OR: [
            { attachments: { equals: [] } },
            { attachments: { equals: Prisma.JsonNull } },
          ],
        },
        select: { id: true },
      });

      for (const point of matchingPoints) {
        await prisma.point.update({
          where: { id: point.id },
          data: { attachments: atts },
        });
        attachmentsUpdated++;
      }
    }

    if (attachmentsUpdated > 0) {
      console.log(`[Google Calendar] 📎 ${attachmentsUpdated} point(s) de tournée mis à jour avec pièces jointes`);
    }
  } catch (e) {
    console.error('[Google Calendar] Erreur propagation pièces jointes:', e);
  }

  console.log(`[Google Calendar] Sync terminée: ${created} créés, ${skipped} déjà en tournée, ${errors} erreurs`);
  return { found: allTaggedEvents.length, created, updated: skipped, errors };
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

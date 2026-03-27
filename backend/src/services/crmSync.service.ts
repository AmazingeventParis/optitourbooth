/**
 * CRM Sync Service
 * Scrapes the Shootnbox CRM (shootnbox.fr/manager2/albums_list.php)
 * and syncs customer emails + phones into OptiTourBooth bookings.
 *
 * Runs every hour via setInterval (configured in app.ts).
 * Read-only on the CRM side — only updates OptiTourBooth bookings.
 */

import { prisma } from '../config/database.js';

// ─── Types ───────────────────────────────────────────────────────

interface CrmAlbum {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  borne: string;
  eventDate: string;       // DD.MM.YYYY
  numFacture: string;      // FAxxxxx
  identifiant: string;     // 6-digit album code
}

interface SyncResult {
  scraped: number;
  matched: number;
  updated: number;
  errors: string[];
}

// ─── Config ──────────────────────────────────────────────────────

const CRM_BASE_URL = 'https://www.shootnbox.fr/manager2';
const CRM_EMAIL = process.env.CRM_SHOOTNBOX_EMAIL || '';
const CRM_PASSWORD = process.env.CRM_SHOOTNBOX_PASSWORD || '';

// ─── Name matching (same logic as googleDrive.service.ts) ────────

function normalizeForMatch(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(crmName: string, bookingName: string): boolean {
  const a = normalizeForMatch(crmName);
  const b = normalizeForMatch(bookingName);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Normalize borne names between CRM and OptiTourBooth
 * CRM uses: Vegas, Ring, Miroir, Vegas Slim, Spinner_360, Aircam_360, etc.
 * OptiTourBooth uses: Vegas, Ring, Miroir, Smakk, Playbox, Aircam, Spinner
 */
function bornesMatch(crmBorne: string, bookingProduit: string | null): boolean {
  if (!bookingProduit) return true; // No produit = can't disqualify
  const a = normalizeForMatch(crmBorne);
  const b = normalizeForMatch(bookingProduit);
  if (!a || !b) return true; // Can't compare = don't disqualify
  return a.includes(b) || b.includes(a);
}

// ─── Date helpers ────────────────────────────────────────────────

/**
 * Parse CRM date format DD.MM.YYYY to Date (UTC)
 */
function parseCrmDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const year = parseInt(match[3]!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Check if two dates are the same day (UTC)
 */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Check if a date falls within a range (inclusive)
 */
function dateInRange(date: Date, start: Date, end: Date | null): boolean {
  const d = date.getTime();
  const s = start.getTime();
  const e = end ? end.getTime() : s;
  return d >= s && d <= e;
}

// ─── CRM Scraping ────────────────────────────────────────────────

/**
 * Login to the CRM and return the session cookie
 */
async function crmLogin(): Promise<string> {
  if (!CRM_EMAIL || !CRM_PASSWORD) {
    throw new Error('CRM credentials not configured (CRM_SHOOTNBOX_EMAIL / CRM_SHOOTNBOX_PASSWORD)');
  }

  const response = await fetch(`${CRM_BASE_URL}/d26386b04e.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `event=login&email=${encodeURIComponent(CRM_EMAIL)}&password=${encodeURIComponent(CRM_PASSWORD)}`,
    redirect: 'manual',
  });

  const text = await response.text();
  if (text.trim() !== 'done') {
    throw new Error(`CRM login failed: ${text.trim()}`);
  }

  // Extract session cookie
  const setCookies = response.headers.getSetCookie?.() || [];
  const cookieHeader = setCookies
    .map(c => c.split(';')[0])
    .join('; ');

  if (!cookieHeader) {
    throw new Error('CRM login succeeded but no session cookie returned');
  }

  return cookieHeader;
}

/**
 * Scrape albums_list.php and extract album data
 */
async function scrapeAlbums(cookie: string): Promise<CrmAlbum[]> {
  const response = await fetch(`${CRM_BASE_URL}/albums_list.php`, {
    headers: { Cookie: cookie },
  });

  const html = await response.text();

  if (html.includes('<title>Entrance</title>')) {
    throw new Error('CRM session expired (redirected to login)');
  }

  const albums: CrmAlbum[] = [];

  // Parse the HTML table — extract rows from <tbody>
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) {
    console.warn('[CRM Sync] No <tbody> found in albums page');
    return albums;
  }

  const rows = tbodyMatch[1]!.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];

  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (cells.length < 8) continue;

    const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();

    // Column 0: ID
    const id = stripHtml(cells[0]!);

    // Column 1: Utilisateur — contains name, email, phone in HTML
    const userHtml = cells[1]!;
    const nameMatch = userHtml.match(/<b>([^<]+)<\/b>/);
    const emailMatch = userHtml.match(/mailto:([^"]+)"/);
    const phoneMatch = userHtml.match(/tel:([^"]+)"/);

    const customerName = nameMatch ? nameMatch[1]!.trim() : '';
    const customerEmail = emailMatch ? emailMatch[1]!.trim() : '';
    const customerPhone = phoneMatch ? phoneMatch[1]!.trim() : '';

    // Column 2: Borne
    const borne = stripHtml(cells[2]!);

    // Column 3: Num ID (facture)
    const numFacture = stripHtml(cells[3]!);

    // Column 4: Identifiant (album code)
    const identifiant = stripHtml(cells[4]!);

    // Column 5: Date de l'événement
    const eventDate = stripHtml(cells[5]!);

    // Skip entries without email
    if (!customerEmail) continue;

    albums.push({
      id,
      customerName,
      customerEmail,
      customerPhone,
      borne,
      eventDate,
      numFacture,
      identifiant,
    });
  }

  return albums;
}

// ─── Matching & Sync ─────────────────────────────────────────────

/**
 * Main sync function: scrape CRM albums and update OptiTourBooth bookings
 */
export async function syncCrmEmails(): Promise<SyncResult> {
  const result: SyncResult = { scraped: 0, matched: 0, updated: 0, errors: [] };

  // 1. Login to CRM
  let cookie: string;
  try {
    cookie = await crmLogin();
  } catch (e: any) {
    result.errors.push(`Login failed: ${e.message}`);
    return result;
  }

  // 2. Scrape albums
  let albums: CrmAlbum[];
  try {
    albums = await scrapeAlbums(cookie);
    result.scraped = albums.length;
  } catch (e: any) {
    result.errors.push(`Scrape failed: ${e.message}`);
    return result;
  }

  if (albums.length === 0) {
    result.errors.push('No albums scraped (page may have changed)');
    return result;
  }

  // 3. Get bookings that need email
  const bookings = await prisma.booking.findMany({
    where: {
      OR: [
        { customerEmail: null },
        { customerEmail: '' },
      ],
    },
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      eventDate: true,
      eventEndDate: true,
      produitNom: true,
    },
  });

  if (bookings.length === 0) {
    console.log('[CRM Sync] All bookings already have emails — nothing to sync');
    return result;
  }

  // 4. Match and update
  for (const booking of bookings) {
    // Find matching CRM album(s)
    const candidates = albums.filter(album => {
      // Parse CRM date
      const crmDate = parseCrmDate(album.eventDate);
      if (!crmDate) return false;

      // Date must match (same day or within date range)
      const dateOk = dateInRange(crmDate, booking.eventDate, booking.eventEndDate);
      if (!dateOk) return false;

      // Name must fuzzy match
      const nameOk = namesMatch(album.customerName, booking.customerName);
      if (!nameOk) return false;

      return true;
    });

    if (candidates.length === 0) continue;

    // If multiple candidates, prefer one where borne also matches
    let best = candidates[0]!;
    if (candidates.length > 1) {
      const borneMatch = candidates.find(c => bornesMatch(c.borne, booking.produitNom));
      if (borneMatch) best = borneMatch;
    }

    result.matched++;

    // Update booking with email (and phone if missing)
    try {
      const updateData: Record<string, string> = {
        customerEmail: best.customerEmail,
      };

      if (!booking.customerPhone && best.customerPhone) {
        updateData.customerPhone = best.customerPhone;
      }

      await prisma.booking.update({
        where: { id: booking.id },
        data: updateData,
      });

      result.updated++;
      console.log(
        `[CRM Sync] Updated booking "${booking.customerName}" (${booking.eventDate.toISOString().slice(0, 10)}) → ${best.customerEmail}`
      );
    } catch (e: any) {
      result.errors.push(`Update failed for booking ${booking.id}: ${e.message}`);
    }
  }

  return result;
}

// ─── Cron control ────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startCrmSync(): void {
  if (!CRM_EMAIL || !CRM_PASSWORD) {
    console.log('[CRM Sync] Credentials not configured (CRM_SHOOTNBOX_EMAIL / CRM_SHOOTNBOX_PASSWORD), sync disabled');
    return;
  }

  const intervalMs = 60 * 60 * 1000; // 1 hour

  // Initial sync after 30 seconds (let other services start first)
  setTimeout(async () => {
    try {
      const result = await syncCrmEmails();
      console.log(`[CRM Sync] Initial sync: scraped=${result.scraped}, matched=${result.matched}, updated=${result.updated}`);
      if (result.errors.length > 0) {
        console.warn('[CRM Sync] Errors:', result.errors);
      }
    } catch (e) {
      console.error('[CRM Sync] Initial sync error:', e);
    }
  }, 30_000);

  // Periodic sync every hour
  syncInterval = setInterval(async () => {
    try {
      const result = await syncCrmEmails();
      console.log(`[CRM Sync] Sync: scraped=${result.scraped}, matched=${result.matched}, updated=${result.updated}`);
      if (result.errors.length > 0) {
        console.warn('[CRM Sync] Errors:', result.errors);
      }
    } catch (e) {
      console.error('[CRM Sync] Sync error:', e);
    }
  }, intervalMs);

  console.log(`⏰ CRON: CRM email sync every 60 min`);
}

export function stopCrmSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[CRM Sync] Sync stopped');
  }
}

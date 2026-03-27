/**
 * CRM Sync Service
 * Scrapes the Shootnbox CRM (shootnbox.fr/manager2/) and syncs customer
 * emails + phones into OptiTourBooth bookings.
 *
 * Strategy:
 *  1. Scrape readiness_ajax.php → gets (orderId, date, société, nom, borne)
 *  2. Scrape albums_list.php    → gets (orderId, nom, email, phone, borne, date)
 *  3. Join on orderId           → enriched record with société + email
 *  4. Match booking by date + fuzzy(société OR nom) → update customerEmail
 *
 * OptiTourBooth booking names come from Google Calendar event titles, which
 * are usually the company name (société), not the contact person (nom).
 * The readiness page provides the société↔nom↔orderId link.
 *
 * Runs every hour via setInterval (configured in app.ts).
 * Read-only on the CRM side — only updates OptiTourBooth bookings.
 */

import { prisma } from '../config/database.js';

// ─── Types ───────────────────────────────────────────────────────

interface CrmRecord {
  orderId: string;
  societe: string;
  contactName: string;
  email: string;
  phone: string;
  borne: string;
  eventDate: string; // DD.MM.YYYY
}

interface SyncResult {
  scrapedAlbums: number;
  scrapedReadiness: number;
  enriched: number;
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
  // Bidirectional substring
  if (a.includes(b) || b.includes(a)) return true;
  // Also try matching first 6+ chars (handles truncated/suffixed names)
  if (a.length >= 6 && b.length >= 6) {
    if (a.startsWith(b.slice(0, 6)) || b.startsWith(a.slice(0, 6))) return true;
  }
  return false;
}

function bornesMatch(crmBorne: string, bookingProduit: string | null): boolean {
  if (!bookingProduit) return true;
  const a = normalizeForMatch(crmBorne);
  const b = normalizeForMatch(bookingProduit);
  if (!a || !b) return true;
  return a.includes(b) || b.includes(a);
}

// ─── Date helpers ────────────────────────────────────────────────

function parseCrmDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const year = parseInt(match[3]!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateInRange(date: Date, start: Date, end: Date | null): boolean {
  const d = date.getTime();
  const s = start.getTime();
  const e = end ? end.getTime() : s;
  return d >= s && d <= e;
}

// ─── HTML helpers ────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
}

// ─── CRM Scraping ────────────────────────────────────────────────

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

  const setCookies = response.headers.getSetCookie?.() || [];
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');

  if (!cookieHeader) {
    throw new Error('CRM login succeeded but no session cookie returned');
  }

  return cookieHeader;
}

/**
 * Scrape readiness_ajax.php → orderId, date, société, nom, borne
 * This page links company names (société) to contact names (nom) via orderId.
 */
async function scrapeReadiness(cookie: string): Promise<Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>> {
  const map = new Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>();

  // Fetch all rows (up to 500)
  const response = await fetch(`${CRM_BASE_URL}/readiness_ajax.php`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'draw=1&start=0&length=500',
  });

  const data = await response.json() as any;
  const rows = data.aaData || data.data || [];

  for (const row of rows) {
    const orderId = String(stripHtml(String(row.id || ''))).trim();
    if (!orderId) continue;

    const dateRaw = stripHtml(String(row.date || ''));
    const dateMatch = dateRaw.match(/^(\d{2}\.\d{2}\.\d{4})/);
    const eventDate = dateMatch ? dateMatch[1]! : '';

    const societe = stripHtml(String(row.societe || ''));
    const contactName = stripHtml(String(row.name || ''));
    const borne = stripHtml(String(row.borne || ''));

    map.set(orderId, { societe, contactName, eventDate, borne });
  }

  return map;
}

/**
 * Scrape albums_list.php → orderId, nom, email, phone, borne, date
 * This page has the customer emails.
 */
async function scrapeAlbums(cookie: string): Promise<Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>> {
  const map = new Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>();

  const response = await fetch(`${CRM_BASE_URL}/albums_list.php`, {
    headers: { Cookie: cookie },
  });

  const html = await response.text();

  if (html.includes('<title>Entrance</title>')) {
    throw new Error('CRM session expired (redirected to login)');
  }

  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) {
    console.warn('[CRM Sync] No <tbody> found in albums page');
    return map;
  }

  const rows = tbodyMatch[1]!.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];

  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (cells.length < 8) continue;

    const orderId = stripHtml(cells[0]!);
    const userHtml = cells[1]!;
    const nameMatch = userHtml.match(/<b>([^<]+)<\/b>/);
    const emailMatch = userHtml.match(/mailto:([^"]+)"/);
    const phoneMatch = userHtml.match(/tel:([^"]+)"/);

    const contactName = nameMatch ? nameMatch[1]!.trim() : '';
    const email = emailMatch ? emailMatch[1]!.trim() : '';
    const phone = phoneMatch ? phoneMatch[1]!.trim() : '';
    const borne = stripHtml(cells[2]!);
    const eventDate = stripHtml(cells[5]!);

    if (!email) continue;

    map.set(orderId, { contactName, email, phone, borne, eventDate });
  }

  return map;
}

/**
 * Merge readiness (société) + albums (email) into enriched CRM records.
 * Join on orderId. Also include album-only records (no société = use contactName).
 */
function buildEnrichedRecords(
  readinessMap: Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>,
  albumsMap: Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>,
): CrmRecord[] {
  const records: CrmRecord[] = [];

  // For each album entry with an email, enrich with readiness data
  for (const [orderId, album] of albumsMap) {
    const readiness = readinessMap.get(orderId);

    records.push({
      orderId,
      societe: readiness?.societe || '',
      contactName: album.contactName || readiness?.contactName || '',
      email: album.email,
      phone: album.phone,
      borne: readiness?.borne || album.borne,
      eventDate: readiness?.eventDate || album.eventDate,
    });
  }

  return records;
}

// ─── Matching & Sync ─────────────────────────────────────────────

/**
 * Try to match a booking name against a CRM record.
 * Booking names are usually company names (from Google Calendar).
 * CRM has both société (company) and contactName (person).
 * We try matching against both.
 */
function recordMatchesBooking(
  record: CrmRecord,
  bookingName: string,
  bookingDate: Date,
  bookingEndDate: Date | null,
): boolean {
  // 1. Date must match
  const crmDate = parseCrmDate(record.eventDate);
  if (!crmDate) return false;
  if (!dateInRange(crmDate, bookingDate, bookingEndDate)) return false;

  // 2. Try matching booking name against société first (most common case)
  if (record.societe && namesMatch(record.societe, bookingName)) return true;

  // 3. Try matching against contact name
  if (record.contactName && namesMatch(record.contactName, bookingName)) return true;

  return false;
}

/**
 * Main sync function: scrape CRM and update OptiTourBooth bookings
 */
export async function syncCrmEmails(): Promise<SyncResult> {
  const result: SyncResult = {
    scrapedAlbums: 0,
    scrapedReadiness: 0,
    enriched: 0,
    matched: 0,
    updated: 0,
    errors: [],
  };

  // 1. Login to CRM
  let cookie: string;
  try {
    cookie = await crmLogin();
  } catch (e: any) {
    result.errors.push(`Login failed: ${e.message}`);
    return result;
  }

  // 2. Scrape both sources in parallel
  let readinessMap: Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>;
  let albumsMap: Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>;

  try {
    [readinessMap, albumsMap] = await Promise.all([
      scrapeReadiness(cookie),
      scrapeAlbums(cookie),
    ]);
    result.scrapedReadiness = readinessMap.size;
    result.scrapedAlbums = albumsMap.size;
  } catch (e: any) {
    result.errors.push(`Scrape failed: ${e.message}`);
    return result;
  }

  // 3. Build enriched records (société + email joined on orderId)
  const records = buildEnrichedRecords(readinessMap, albumsMap);
  result.enriched = records.length;

  if (records.length === 0) {
    result.errors.push('No enriched records built');
    return result;
  }

  // 4. Get bookings that need email
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

  // 5. Match and update
  for (const booking of bookings) {
    const candidates = records.filter(r =>
      recordMatchesBooking(r, booking.customerName, booking.eventDate, booking.eventEndDate)
    );

    if (candidates.length === 0) continue;

    // Pick best: prefer one where borne also matches
    let best = candidates[0]!;
    if (candidates.length > 1) {
      const borneMatch = candidates.find(c => bornesMatch(c.borne, booking.produitNom));
      if (borneMatch) best = borneMatch;
    }

    result.matched++;

    try {
      const updateData: Record<string, string> = {
        customerEmail: best.email,
      };

      if (!booking.customerPhone && best.phone) {
        updateData.customerPhone = best.phone;
      }

      await prisma.booking.update({
        where: { id: booking.id },
        data: updateData,
      });

      result.updated++;
      console.log(
        `[CRM Sync] ✓ "${booking.customerName}" → ${best.email}` +
        (best.societe ? ` (société: ${best.societe})` : '')
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
      console.log(
        `[CRM Sync] Initial: readiness=${result.scrapedReadiness}, albums=${result.scrapedAlbums}, ` +
        `enriched=${result.enriched}, matched=${result.matched}, updated=${result.updated}`
      );
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
      console.log(
        `[CRM Sync] Sync: readiness=${result.scrapedReadiness}, albums=${result.scrapedAlbums}, ` +
        `enriched=${result.enriched}, matched=${result.matched}, updated=${result.updated}`
      );
      if (result.errors.length > 0) {
        console.warn('[CRM Sync] Errors:', result.errors);
      }
    } catch (e) {
      console.error('[CRM Sync] Sync error:', e);
    }
  }, intervalMs);

  console.log('⏰ CRON: CRM email sync every 60 min');
}

export function stopCrmSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[CRM Sync] Sync stopped');
  }
}

/**
 * CRM Sync Service
 * Scrapes the Shootnbox CRM (shootnbox.fr/manager2/) and syncs customer
 * emails + phones into OptiTourBooth bookings.
 *
 * Strategy (3 sources, priority order):
 *  1. orders_ajax.php?status=2 (confirmed reservations) → best source:
 *     has email, phone, company+person in "customer" field, event date, borne
 *  2. readiness_ajax.php (preparation) → has société ↔ nom link
 *  3. albums_list.php (past events) → has email but only contact name
 *
 * Matching: date + fuzzy(company name OR contact name OR person name)
 * against OptiTourBooth booking customerName (from Google Calendar = company).
 *
 * Runs every hour via setInterval (configured in app.ts).
 * Read-only on the CRM side — only updates OptiTourBooth bookings.
 */

import { prisma } from '../config/database.js';

// ─── Types ───────────────────────────────────────────────────────

interface CrmRecord {
  orderId: string;
  company: string;       // société / company name
  contactName: string;   // person name
  email: string;
  phone: string;
  borne: string;
  eventDate: string;     // DD.MM.YYYY
  source: 'orders' | 'readiness+albums' | 'albums';
}

interface SyncResult {
  scrapedOrders: number;
  scrapedReadiness: number;
  scrapedAlbums: number;
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
  if (a.includes(b) || b.includes(a)) return true;
  // Prefix match for truncated/suffixed names (min 5 chars)
  if (a.length >= 5 && b.length >= 5) {
    if (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))) return true;
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

/**
 * Parse the "customer" field from orders_ajax.php.
 * Format: "COMPANY    PERSON  Lieu de l'évènement : ..." or "Person Name  Lieu..."
 * Returns [company, person].
 */
function parseCustomerField(raw: string): [string, string] {
  let text = stripHtml(raw);
  // Remove everything after location/event type markers
  for (const sep of ["Lieu de l'", "Type d'", 'Retrait']) {
    const idx = text.indexOf(sep);
    if (idx > 0) text = text.slice(0, idx).trim();
  }
  // Split by 3+ spaces (company vs person)
  const parts = text.split(/\s{3,}/);
  if (parts.length >= 2) {
    return [parts[0]!.trim(), parts[1]!.trim()];
  }
  return ['', parts[0]!.trim()];
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
 * Source 1: Scrape orders_ajax.php?status=2 (confirmed reservations)
 * Best source — has company name, person name, email, phone, date, borne.
 */
async function scrapeOrders(cookie: string): Promise<CrmRecord[]> {
  const records: CrmRecord[] = [];

  const response = await fetch(`${CRM_BASE_URL}/orders_ajax.php?status=2`, {
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
    const email = stripHtml(String(row.email || ''));
    if (!email) continue;

    const orderId = String(row.id || '').trim();
    const [company, person] = parseCustomerField(String(row.customer || ''));
    const phone = stripHtml(String(row.phone || ''));
    const borne = stripHtml(String(row.box_type || ''));
    const eventDate = stripHtml(String(row.event_date || ''));

    records.push({
      orderId,
      company,
      contactName: person,
      email,
      phone,
      borne,
      eventDate,
      source: 'orders',
    });
  }

  return records;
}

/**
 * Source 2: Scrape readiness_ajax.php (preparation page)
 * Has société ↔ nom link. No email — must be joined with albums.
 */
async function scrapeReadiness(cookie: string): Promise<Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>> {
  const map = new Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>();

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
 * Source 3: Scrape albums_list.php (past events with photos)
 * Has email + phone, but only contact name (no company).
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

// ─── Merge sources ───────────────────────────────────────────────

/**
 * Merge readiness (société) + albums (email) into additional records.
 * These complement the orders source for past events not in reservations.
 */
function buildAlbumRecords(
  readinessMap: Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>,
  albumsMap: Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>,
  existingOrderIds: Set<string>,
): CrmRecord[] {
  const records: CrmRecord[] = [];

  for (const [orderId, album] of albumsMap) {
    // Skip if already covered by orders source
    if (existingOrderIds.has(orderId)) continue;

    const readiness = readinessMap.get(orderId);

    records.push({
      orderId,
      company: readiness?.societe || '',
      contactName: album.contactName || readiness?.contactName || '',
      email: album.email,
      phone: album.phone,
      borne: readiness?.borne || album.borne,
      eventDate: readiness?.eventDate || album.eventDate,
      source: readiness ? 'readiness+albums' : 'albums',
    });
  }

  return records;
}

// ─── Matching & Sync ─────────────────────────────────────────────

function recordMatchesBooking(
  record: CrmRecord,
  bookingName: string,
  bookingDate: Date,
  bookingEndDate: Date | null,
): boolean {
  const crmDate = parseCrmDate(record.eventDate);
  if (!crmDate) return false;
  if (!dateInRange(crmDate, bookingDate, bookingEndDate)) return false;

  // Try company name first (most common for OptiTourBooth bookings)
  if (record.company && namesMatch(record.company, bookingName)) return true;

  // Try contact/person name
  if (record.contactName && namesMatch(record.contactName, bookingName)) return true;

  return false;
}

/**
 * Main sync function: scrape CRM and update OptiTourBooth bookings
 */
export async function syncCrmEmails(): Promise<SyncResult> {
  const result: SyncResult = {
    scrapedOrders: 0,
    scrapedReadiness: 0,
    scrapedAlbums: 0,
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

  // 2. Scrape all 3 sources in parallel
  let orderRecords: CrmRecord[];
  let readinessMap: Map<string, { societe: string; contactName: string; eventDate: string; borne: string }>;
  let albumsMap: Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>;

  try {
    [orderRecords, readinessMap, albumsMap] = await Promise.all([
      scrapeOrders(cookie),
      scrapeReadiness(cookie),
      scrapeAlbums(cookie),
    ]);
    result.scrapedOrders = orderRecords.length;
    result.scrapedReadiness = readinessMap.size;
    result.scrapedAlbums = albumsMap.size;
  } catch (e: any) {
    result.errors.push(`Scrape failed: ${e.message}`);
    return result;
  }

  // 3. Build complete record set: orders first (best), then albums+readiness for the rest
  const orderIds = new Set(orderRecords.map(r => r.orderId));
  const albumRecords = buildAlbumRecords(readinessMap, albumsMap, orderIds);
  const allRecords = [...orderRecords, ...albumRecords];

  if (allRecords.length === 0) {
    result.errors.push('No CRM records found');
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
    const candidates = allRecords.filter(r =>
      recordMatchesBooking(r, booking.customerName, booking.eventDate, booking.eventEndDate)
    );

    if (candidates.length === 0) continue;

    // Pick best: prefer orders source, then borne match
    let best = candidates[0]!;
    const fromOrders = candidates.filter(c => c.source === 'orders');
    if (fromOrders.length > 0) {
      best = fromOrders[0]!;
      if (fromOrders.length > 1) {
        const borneMatch = fromOrders.find(c => bornesMatch(c.borne, booking.produitNom));
        if (borneMatch) best = borneMatch;
      }
    } else if (candidates.length > 1) {
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
        `[CRM Sync] ✓ "${booking.customerName}" → ${best.email} [${best.source}]` +
        (best.company ? ` (company: ${best.company})` : '')
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
        `[CRM Sync] Initial: orders=${result.scrapedOrders}, readiness=${result.scrapedReadiness}, ` +
        `albums=${result.scrapedAlbums}, matched=${result.matched}, updated=${result.updated}`
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
        `[CRM Sync] Sync: orders=${result.scrapedOrders}, readiness=${result.scrapedReadiness}, ` +
        `albums=${result.scrapedAlbums}, matched=${result.matched}, updated=${result.updated}`
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

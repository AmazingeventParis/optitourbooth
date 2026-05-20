/**
 * CRM Sync Service
 * Scrapes ShootNBox CRM (shootnbox.fr/manager2/) and Smakk CRM (smakk.fr/manager/)
 * and syncs customer data into OptiTourBooth bookings.
 *
 * For each booking, stores:
 *   - customerEmail, customerPhone
 *   - companyName, contactName  ← used by Drive scan for better folder matching
 *   - crmOrderId, crmBrand      ← stable dedup key
 *
 * Runs every hour via setInterval (configured in app.ts).
 * Read-only on the CRM side.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../config/database.js';
import { ensureDateUTC } from '../utils/dateUtils.js';

// ─── Types ───────────────────────────────────────────────────────

interface CrmRecord {
  orderId: string;
  numId?: string;        // FA number (ShootNBox only, e.g. "FA14016")
  company: string;       // société / company name
  contactName: string;   // person name
  eventName?: string;    // "Nom d'Event" from readiness (matches Drive folder name)
  email: string;
  phone: string;
  borne: string;
  eventDate: string;     // DD.MM.YYYY
  brand: 'shootnbox' | 'smakk';
  source: 'orders' | 'readiness+albums' | 'albums';
}

interface SyncResult {
  shootnbox: { scrapedOrders: number; scrapedReadiness: number; scrapedAlbums: number };
  smakk: { scrapedOrders: number };
  matched: number;
  updated: number;
  created: number;
  errors: string[];
}

// ─── Config ──────────────────────────────────────────────────────

const SHOOTNBOX_BASE = 'https://shootnbox.fr/manager2';
// Smakk uses a direct DB API endpoint (session login doesn't share credentials)
const SMAKK_API_URL = 'https://www.smakk.fr/manager/_otb_orders.php';
const SMAKK_API_KEY = 'opti2026smk_x7kR9qNv';

const SHOOTNBOX_EMAIL = process.env.CRM_SHOOTNBOX_EMAIL || '';
const SHOOTNBOX_PASSWORD = process.env.CRM_SHOOTNBOX_PASSWORD || '';

// ─── Name matching ────────────────────────────────────────────────

function normalizeForMatch(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(crmName: string, bookingName: string): boolean {
  const a = normalizeForMatch(crmName);
  const b = normalizeForMatch(bookingName);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
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

// ─── Date helpers ─────────────────────────────────────────────────

function parseCrmDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const year = parseInt(match[3]!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Allow ±2 days around the booking date range.
// LIR bookings: eventDate = delivery day (D), eventEndDate = pickup day (D+2).
// ShootNBox CRM: event_date = actual event day (D+1), so exact range match fails.
function dateInRange(date: Date, start: Date, end: Date | null): boolean {
  const d = date.getTime();
  const s = start.getTime() - 2 * DAY_MS;
  const e = (end ? end.getTime() : start.getTime()) + 2 * DAY_MS;
  return d >= s && d <= e;
}

// ─── HTML helpers ─────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
}

function parseCustomerField(raw: string): [string, string] {
  let text = stripHtml(raw);
  for (const sep of ["Lieu de l'", "Type d'", 'Retrait']) {
    const idx = text.indexOf(sep);
    if (idx > 0) text = text.slice(0, idx).trim();
  }
  const parts = text.split(/\s{3,}/);
  if (parts.length >= 2) {
    return [parts[0]!.trim(), parts[1]!.trim()];
  }
  return ['', parts[0]!.trim()];
}

// ─── Generic CRM login ────────────────────────────────────────────

async function crmLogin(baseUrl: string, email: string, password: string, brand: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${baseUrl}/d26386b04e.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `event=login&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    redirect: 'manual',
    signal,
  });

  const text = await response.text();
  if (text.trim() !== 'done') {
    throw new Error(`${brand} CRM login failed: ${text.trim()}`);
  }

  const setCookies = response.headers.getSetCookie?.() || [];
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');

  if (!cookieHeader) {
    throw new Error(`${brand} CRM login succeeded but no session cookie returned`);
  }

  return cookieHeader;
}

// ─── Paginated orders fetch ───────────────────────────────────────

async function fetchOrdersPage(
  cookie: string, url: string, start: number, length: number, signal?: AbortSignal,
): Promise<{ rows: any[]; totalFiltered: number }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `draw=1&start=${start}&length=${length}`,
    signal,
  });

  const data = await response.json() as any;
  return {
    rows: data.aaData || data.data || [],
    totalFiltered: data.iTotalDisplayRecords || data.recordsFiltered || 0,
  };
}

function parseOrderRows(rows: any[], brand: 'shootnbox' | 'smakk'): CrmRecord[] {
  const records: CrmRecord[] = [];

  for (const row of rows) {
    const email = stripHtml(String(row.email || ''));
    if (!email) continue;

    const orderId = String(row.id || '').trim();
    const [company, person] = parseCustomerField(String(row.customer || ''));
    const phone = stripHtml(String(row.phone || ''));
    const borne = stripHtml(String(row.box_type || ''));
    const eventDate = stripHtml(String(row.event_date || ''));

    // Extract FA number from facture HTML field (ShootNBox only)
    const numIdMatch = brand === 'shootnbox'
      ? stripHtml(String(row.facture || '')).match(/FA\d+/)
      : null;
    const numId = numIdMatch ? numIdMatch[0] : undefined;

    records.push({
      orderId,
      numId,
      company,
      contactName: person,
      email,
      phone,
      borne,
      eventDate,
      brand,
      source: 'orders',
    });
  }

  return records;
}

// ─── ShootNBox scraping ───────────────────────────────────────────

async function scrapeShootnboxOrders(cookie: string, signal?: AbortSignal): Promise<CrmRecord[]> {
  const PAGE_SIZE = 500;
  const records: CrmRecord[] = [];

  // Paginate both current and archive (upcoming events are in current, past in archive)
  for (const urlSuffix of ['orders_ajax.php?status=2', 'orders_ajax.php?status=2&arch=true']) {
    const url = `${SHOOTNBOX_BASE}/${urlSuffix}`;
    let start = 0;
    let total = 0;
    do {
      const page = await fetchOrdersPage(cookie, url, start, PAGE_SIZE, signal);
      if (page.rows.length === 0) break;
      records.push(...parseOrderRows(page.rows, 'shootnbox'));
      total = page.totalFiltered;
      start += PAGE_SIZE;
    } while (start < total);
  }

  return records;
}

async function scrapeShootnboxReadiness(cookie: string, signal?: AbortSignal): Promise<Map<string, { societe: string; contactName: string; eventName: string; eventDate: string; borne: string }>> {
  const map = new Map<string, { societe: string; contactName: string; eventName: string; eventDate: string; borne: string }>();

  const response = await fetch(`${SHOOTNBOX_BASE}/readiness_ajax.php`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'draw=1&start=0&length=500',
    signal,
  });

  const data = await response.json() as any;
  const rows = data.aaData || data.data || [];

  for (const row of rows) {
    const orderId = String(stripHtml(String(row.id || ''))).trim();
    if (!orderId) continue;

    const dateRaw = stripHtml(String(row.date || ''));
    const dateMatch = dateRaw.match(/^(\d{2}\.\d{2}\.\d{4})/);
    const eventDate = dateMatch ? dateMatch[1]! : '';

    map.set(orderId, {
      societe: stripHtml(String(row.societe || '')),
      contactName: stripHtml(String(row.name || '')),
      eventName: stripHtml(String(row.nom_event || '')),
      eventDate,
      borne: stripHtml(String(row.borne || '')),
    });
  }

  return map;
}

async function scrapeShootnboxAlbums(cookie: string, signal?: AbortSignal): Promise<Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>> {
  const map = new Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>();

  const response = await fetch(`${SHOOTNBOX_BASE}/albums_list.php`, {
    headers: { Cookie: cookie },
    signal,
  });

  const html = await response.text();
  if (html.includes('<title>Entrance</title>')) {
    throw new Error('ShootNBox CRM session expired (redirected to login)');
  }

  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return map;

  const rows = tbodyMatch[1]!.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];

  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (cells.length < 8) continue;

    const orderId = stripHtml(cells[0]!);
    const userHtml = cells[1]!;
    const nameMatch = userHtml.match(/<b>([^<]+)<\/b>/);
    const emailMatch = userHtml.match(/mailto:([^"]+)"/);
    const phoneMatch = userHtml.match(/tel:([^"]+)"/);

    const email = emailMatch ? emailMatch[1]!.trim() : '';
    if (!email) continue;

    map.set(orderId, {
      contactName: nameMatch ? nameMatch[1]!.trim() : '',
      email,
      phone: phoneMatch ? phoneMatch[1]!.trim() : '',
      borne: stripHtml(cells[2]!),
      eventDate: stripHtml(cells[5]!),
    });
  }

  return map;
}

function buildAlbumRecords(
  readinessMap: Map<string, { societe: string; contactName: string; eventName: string; eventDate: string; borne: string }>,
  albumsMap: Map<string, { contactName: string; email: string; phone: string; borne: string; eventDate: string }>,
  existingOrderIds: Set<string>,
): CrmRecord[] {
  const records: CrmRecord[] = [];

  for (const [orderId, album] of albumsMap) {
    if (existingOrderIds.has(orderId)) continue;

    const readiness = readinessMap.get(orderId);

    records.push({
      orderId,
      company: readiness?.societe || '',
      contactName: album.contactName || readiness?.contactName || '',
      eventName: readiness?.eventName || '',
      email: album.email,
      phone: album.phone,
      borne: readiness?.borne || album.borne,
      eventDate: readiness?.eventDate || album.eventDate,
      brand: 'shootnbox',
      source: readiness ? 'readiness+albums' : 'albums',
    });
  }

  return records;
}

// ─── Smakk direct API ────────────────────────────────────────────
// Smakk CRM has a dedicated lightweight API endpoint on their server
// (_otb_orders.php) that queries the DB directly and returns JSON.
// This avoids session-based scraping which requires separate credentials.

async function fetchSmakkOrders(signal?: AbortSignal): Promise<CrmRecord[]> {
  const PAGE_SIZE = 500;
  const records: CrmRecord[] = [];

  let page = 0;
  let total = 0;

  do {
    const url = `${SMAKK_API_URL}?key=${SMAKK_API_KEY}&page=${page}&size=${PAGE_SIZE}`;
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`Smakk API returned HTTP ${response.status}`);
    }

    const data = await response.json() as any;

    if (data.error) {
      throw new Error(`Smakk API error: ${data.error}`);
    }

    total = data.total || 0;

    for (const row of (data.data || [])) {
      const email = (row.email || '').trim();
      if (!email) continue;

      const contactName = [row.first_name, row.last_name].filter(Boolean).map((s: string) => s.trim()).join(' ');

      records.push({
        orderId: String(row.id),
        numId: (row.num_id || '').trim() || undefined,
        company: (row.company || '').trim(),
        contactName,
        email,
        phone: (row.phone || '').trim(),
        borne: (row.box_type || '').trim(),
        eventDate: (row.event_date || '').trim(),
        brand: 'smakk',
        source: 'orders',
      });
    }

    const pageRows = (data.data || []).length;
    page++;
    if (pageRows === 0) break;
  } while (page * PAGE_SIZE < total);

  return records;
}

// ─── Matching ─────────────────────────────────────────────────────

function recordMatchesBooking(
  record: CrmRecord,
  bookingName: string,
  bookingDate: Date,
  bookingEndDate: Date | null,
): boolean {
  const crmDate = parseCrmDate(record.eventDate);
  if (!crmDate) return false;
  if (!dateInRange(crmDate, bookingDate, bookingEndDate)) return false;

  if (record.company && namesMatch(record.company, bookingName)) return true;
  if (record.contactName && namesMatch(record.contactName, bookingName)) return true;

  return false;
}

// ─── Main sync ────────────────────────────────────────────────────

export async function syncCrmData(): Promise<SyncResult> {
  // One AbortController for the entire sync — aborts everything after 90 seconds
  const controller = new AbortController();
  const masterTimeout = setTimeout(() => {
    controller.abort(new Error('CRM sync master timeout (90s)'));
  }, 90_000);

  try {
    return await _syncCrmData(controller.signal);
  } catch (e: any) {
    lastSyncResult = {
      shootnbox: { scrapedOrders: 0, scrapedReadiness: 0, scrapedAlbums: 0 },
      smakk: { scrapedOrders: 0 },
      matched: 0,
      updated: 0,
      created: 0,
      errors: [e.message || 'Unknown sync error'],
      completedAt: new Date().toISOString(),
    };
    throw e;
  } finally {
    clearTimeout(masterTimeout);
  }
}

async function _syncCrmData(signal: AbortSignal): Promise<SyncResult> {
  const result: SyncResult = {
    shootnbox: { scrapedOrders: 0, scrapedReadiness: 0, scrapedAlbums: 0 },
    smakk: { scrapedOrders: 0 },
    matched: 0,
    updated: 0,
    created: 0,
    errors: [],
  };

  const allRecords: CrmRecord[] = [];

  // ── ShootNBox ──
  if (SHOOTNBOX_EMAIL && SHOOTNBOX_PASSWORD) {
    try {
      const cookie = await crmLogin(SHOOTNBOX_BASE, SHOOTNBOX_EMAIL, SHOOTNBOX_PASSWORD, 'ShootNBox', signal);
      const [orderRecords, readinessMap, albumsMap] = await Promise.all([
        scrapeShootnboxOrders(cookie, signal),
        scrapeShootnboxReadiness(cookie, signal),
        scrapeShootnboxAlbums(cookie, signal),
      ]);

      result.shootnbox.scrapedOrders = orderRecords.length;
      result.shootnbox.scrapedReadiness = readinessMap.size;
      result.shootnbox.scrapedAlbums = albumsMap.size;

      // Enrich orderRecords with eventName from readiness (orders_ajax doesn't have nom_event)
      for (const rec of orderRecords) {
        const readiness = readinessMap.get(rec.orderId);
        if (readiness?.eventName) rec.eventName = readiness.eventName;
        if (!rec.company && readiness?.societe) rec.company = readiness.societe;
      }

      const orderIds = new Set(orderRecords.map(r => r.orderId));
      allRecords.push(...orderRecords);
      allRecords.push(...buildAlbumRecords(readinessMap, albumsMap, orderIds));
    } catch (e: any) {
      result.errors.push(`ShootNBox: ${e.message}`);
    }
  } else {
    result.errors.push('ShootNBox: credentials not configured (CRM_SHOOTNBOX_EMAIL / CRM_SHOOTNBOX_PASSWORD)');
  }

  // ── Smakk ──
  try {
    const smakkRecords = await fetchSmakkOrders(signal);
    result.smakk.scrapedOrders = smakkRecords.length;
    allRecords.push(...smakkRecords);
  } catch (e: any) {
    result.errors.push(`Smakk: ${e.message}`);
  }

  if (allRecords.length === 0) {
    result.errors.push('No CRM records found from any source');
    return result;
  }

  // ── Match and update ALL bookings ──
  // Target all bookings — even those with email — so companyName/contactName always stay fresh
  const bookings = await prisma.booking.findMany({
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      eventDate: true,
      eventEndDate: true,
      produitNom: true,
      crmOrderId: true,
    },
  });

  const matchedCrmOrderIds = new Set<string>();

  for (const booking of bookings) {
    // If already linked by crmOrderId, just refresh that record
    let candidates: CrmRecord[];
    if (booking.crmOrderId) {
      candidates = allRecords.filter(r => r.orderId === booking.crmOrderId);
      // Fall back to name match if the order isn't in current scrape (e.g. deep archive)
      if (candidates.length === 0) {
        candidates = allRecords.filter(r =>
          recordMatchesBooking(r, booking.customerName, booking.eventDate, booking.eventEndDate)
        );
      }
    } else {
      candidates = allRecords.filter(r =>
        recordMatchesBooking(r, booking.customerName, booking.eventDate, booking.eventEndDate)
      );
    }

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
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          ...(best.email && { customerEmail: best.email }),
          ...(!booking.customerPhone && best.phone && { customerPhone: best.phone }),
          ...(best.company && { companyName: best.company }),
          ...(best.contactName && { contactName: best.contactName }),
          ...(best.eventName && { eventName: best.eventName }),
          crmOrderId: best.orderId,
          crmBrand: best.brand,
          ...(best.numId && { numId: best.numId }),
        },
      });

      result.updated++;
      matchedCrmOrderIds.add(best.orderId);
      console.log(
        `[CRM Sync] ✓ [${best.brand}] "${booking.customerName}" → ${best.email}` +
        (best.numId ? ` FA:${best.numId}` : ' FA:none') +
        (best.company ? ` (${best.company})` : '') +
        (best.contactName ? ` / ${best.contactName}` : '')
      );
    } catch (e: any) {
      result.errors.push(`Update failed for booking ${booking.id}: ${e.message}`);
    }
  }

  // ── Create bookings for CRM orders with no existing booking ──
  // Deduplicate by orderId, skip orders already matched above
  const seenOrderIds = new Set<string>();
  for (const record of allRecords) {
    if (matchedCrmOrderIds.has(record.orderId)) continue;
    if (seenOrderIds.has(record.orderId)) continue;
    seenOrderIds.add(record.orderId);

    // Only create if we have a valid date
    const eventDate = parseCrmDate(record.eventDate);
    if (!eventDate) continue;

    // Skip records with no usable name
    const customerName = record.eventName || record.company || record.contactName;
    if (!customerName) continue;

    try {
      // Guard 1: same crmOrderId already stored on a booking
      const existingById = await prisma.booking.findFirst({ where: { crmOrderId: record.orderId }, select: { id: true } });
      if (existingById) continue;

      // Guard 2: a booking for the same date+brand already exists (e.g. sibling order for same event)
      // Prevents duplicates when a client has 2 orders (2 bornes) for the same event
      const dateStart = new Date(eventDate);
      dateStart.setUTCDate(dateStart.getUTCDate() - 2);
      const dateEnd = new Date(eventDate);
      dateEnd.setUTCDate(dateEnd.getUTCDate() + 2);
      const nameConditions = ([] as Array<Record<string, string>>).concat(
        record.company ? [{ companyName: record.company }] : [],
        record.contactName ? [{ contactName: record.contactName }] : [],
      );
      if (nameConditions.length > 0) {
        const existingByDate = await prisma.booking.findFirst({
          where: { crmBrand: record.brand, eventDate: { gte: dateStart, lte: dateEnd }, OR: nameConditions },
          select: { id: true },
        });
        if (existingByDate) {
          matchedCrmOrderIds.add(record.orderId);
          continue;
        }
      }

      await prisma.booking.create({
        data: {
          publicToken: randomUUID(),
          customerName,
          customerEmail: record.email || null,
          customerPhone: record.phone || null,
          companyName: record.company || null,
          contactName: record.contactName || null,
          eventName: record.eventName || null,
          eventDate,
          produitNom: record.borne || null,
          crmOrderId: record.orderId,
          crmBrand: record.brand,
          ...(record.numId && { numId: record.numId }),
        },
      });
      result.created++;
      console.log(`[CRM Sync] + Created booking [${record.brand}] "${customerName}" ${record.eventDate}`);
    } catch (e: any) {
      result.errors.push(`Create failed for order ${record.orderId}: ${e.message}`);
    }
  }

  lastSyncResult = { ...result, completedAt: new Date().toISOString() };
  return result;
}

// ─── Last-result cache (readable via GET /bookings/crm-status) ───────

export let lastSyncResult: (SyncResult & { completedAt: string }) | null = null;

// ─── Backward compat export ───────────────────────────────────────

export const syncCrmEmails = syncCrmData;

// ─── CRM → PendingPoints sync ─────────────────────────────────────
// Source de vérité pour les points à dispatcher : orders_ajax.php?status=2
// Filtre : delivery == "Livraison" ET box_type != "Vegas Slim"
// Les informations de livraison viennent du formulaire mail-info-client (otb_cfg_bulk.php)

type PendingLogistics = {
  date: string | null;
  adresse: string | null;
  creneauDebut: string | null;
  creneauFin: string | null;
  contactNom: string | null;
  contactTelephone: string | null;
  notes: string | null;
};

function pendingDateDMY(dmy: string): string | null {
  const m = (dmy || '').match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${(m[2] || '01').padStart(2, '0')}-${(m[1] || '01').padStart(2, '0')}`;
}

function pendingParseCreneau(raw: string): { debut: string; fin: string } | null {
  const cleaned = (raw || '').replace(/\s/g, '');
  const m = cleaned.match(/(\d{1,2})h?(\d{0,2})[–\-à](\d{1,2})h?(\d{0,2})/);
  if (!m) return null;
  const pad = (n: string | undefined) => (n || '0').padStart(2, '0');
  return {
    debut: `${pad(m[1])}:${m[2] ? m[2].padStart(2, '0') : '00'}`,
    fin:   `${pad(m[3])}:${m[4] ? m[4].padStart(2, '0') : '00'}`,
  };
}

function pendingBuildAddress(num?: string, rue?: string, cp?: string, ville?: string): string {
  return [
    [num, rue].filter(Boolean).join(' '),
    [cp, ville].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
}

function pendingParseLogistics(
  d: Record<string, string>,
  type: 'livraison' | 'ramassage',
  logType: string,
): PendingLogistics | null {
  if (logType === 'chronopost' || logType === 'retrait') return null;

  const isRec = type === 'ramassage';
  const useRecupAddr = isRec && d.log_recup_diff === '1' && d.log_recup_rue_nom;
  const adresse = useRecupAddr
    ? pendingBuildAddress(d.log_recup_rue_num, d.log_recup_rue_nom, d.log_recup_cp, d.log_recup_ville)
    : pendingBuildAddress(d.log_rue_num, d.log_rue_nom, d.log_cp, d.log_ville);

  const rawDate = isRec ? d.log_jour_rec : d.log_jour_liv;
  const rawCren = isRec ? d.log_creneau_rec : d.log_creneau_liv;
  const cren = pendingParseCreneau(rawCren || '');
  const noteParts = [d.log_notes, (!isRec && d.log_etage) ? 'Étage sans ascenseur' : ''].filter(Boolean);

  return {
    date: rawDate || null,
    adresse: adresse || null,
    creneauDebut: cren?.debut || null,
    creneauFin: cren?.fin || null,
    contactNom: d.log_contact || null,
    contactTelephone: d.log_contact_tel || null,
    notes: noteParts.join(' / ') || null,
  };
}

export interface PendingPointsSyncResult {
  created: number;
  enriched: number;
  skipped: number;
  errors: string[];
  completedAt?: string;
  debug?: Record<string, any>;
}

export let lastPendingPointsSyncResult: PendingPointsSyncResult | null = null;

export async function syncCrmPendingPoints(): Promise<PendingPointsSyncResult> {
  const result: PendingPointsSyncResult = { created: 0, enriched: 0, skipped: 0, errors: [] };

  if (!SHOOTNBOX_EMAIL || !SHOOTNBOX_PASSWORD) {
    result.errors.push('ShootNBox credentials non configurés');
    return result;
  }

  const controller = new AbortController();
  const masterTimeout = setTimeout(() => controller.abort(new Error('syncCrmPendingPoints timeout (60s)')), 60_000);

  try {
    // 1. Login ShootNBox
    const cookie = await crmLogin(SHOOTNBOX_BASE, SHOOTNBOX_EMAIL, SHOOTNBOX_PASSWORD, 'ShootNBox PendingPoints', controller.signal);
    result.debug = { cookieLen: cookie.length, urlResults: {} as Record<string, any> };

    // 2. Récupérer les commandes actuelles (non-archivées) : delivery=Livraison, box_type!=Vegas Slim
    const PAGE_SIZE = 500;
    const eligible: Array<{
      orderId: string; numId: string | null; clientName: string;
      boxType: string; eventDateISO: string; returnDateISO: string | null;
    }> = [];

    // Query both current and archived orders (future events may be in either)
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    for (const urlSuffix of ['orders_ajax.php?status=2', 'orders_ajax.php?status=2&arch=true']) {
      let start = 0;
      let total = 0;
      do {
        const { rows, totalFiltered } = await fetchOrdersPage(
          cookie, `${SHOOTNBOX_BASE}/${urlSuffix}`, start, PAGE_SIZE, controller.signal
        );
        if (start === 0) {
          (result.debug!.urlResults as Record<string, any>)[urlSuffix] = {
            rowCount: rows.length, totalFiltered,
            allKeys: rows[0] ? Object.keys(rows[0]) : [],
            firstRowFull: rows[0] ? JSON.stringify(rows[0]).slice(0, 2000) : null,
          };
        }
        if (rows.length === 0) break;
        total = totalFiltered;

        for (const row of rows) {
          if (stripHtml(String(row.delivery || '')) !== 'Livraison') continue;
          if (stripHtml(String(row.box_type || '')) === 'Vegas Slim') continue;

          const orderId = String(row.id || '').trim();
          if (!orderId) continue;

          const eventDateISO = pendingDateDMY(stripHtml(String(row.event_date || '')));
          if (!eventDateISO) continue;

          // Only upcoming events (event_date >= today)
          if (new Date(eventDateISO) < today) continue;

          // Deduplicate across both URL passes
          if (eligible.some(e => e.orderId === orderId)) continue;

          const [company, contactName] = parseCustomerField(String(row.customer || ''));
          const clientName = company || contactName || `Commande ${orderId}`;
          const boxType = stripHtml(String(row.box_type || ''));
          const returnDateISO = pendingDateDMY(stripHtml(String(row.return_date || '')));
          const numIdMatch = stripHtml(String(row.facture || '')).match(/FA\d+/);

          eligible.push({ orderId, numId: numIdMatch ? numIdMatch[0] : null, clientName, boxType, eventDateISO, returnDateISO });
        }
        start += PAGE_SIZE;
      } while (start < total);
    }

    console.log(`[CRM PendingPoints] ${eligible.length} commandes éligibles (Livraison, hors Vegas Slim)`);

    // 3. Formulaires mail-info-client soumis (enrichissement)
    const lookupKey = process.env.CRM_LOOKUP_KEY || 'otb_crm_lookup_2026';
    const formByNumId = new Map<string, { d: Record<string, string>; logType: string }>();
    try {
      const resp = await fetch(`https://shootnbox.fr/manager2/otb_cfg_bulk.php?key=${lookupKey}`, { signal: controller.signal });
      const body = await resp.json() as any[];
      for (const cfg of (Array.isArray(body) ? body : [])) {
        if (cfg.num_id && cfg.submitted_data) {
          formByNumId.set(cfg.num_id, { d: cfg.submitted_data, logType: cfg.logistique_type || 'classique' });
        }
      }
      console.log(`[CRM PendingPoints] ${formByNumId.size} formulaires disponibles pour enrichissement`);
    } catch (e) {
      console.warn('[CRM PendingPoints] Formulaires inaccessibles:', e);
    }

    // 4. Créer / enrichir les PendingPoints
    for (const order of eligible) {
      const form = order.numId ? formByNumId.get(order.numId) : undefined;

      // Si le formulaire indique chronopost ou retrait → pas de chauffeur → skip
      if (form && (form.logType === 'chronopost' || form.logType === 'retrait')) {
        result.skipped++;
        continue;
      }

      const parsedLiv = form ? pendingParseLogistics(form.d, 'livraison', form.logType) : null;
      const parsedRec = form ? pendingParseLogistics(form.d, 'ramassage', form.logType) : null;

      const livDate = parsedLiv?.date || order.eventDateISO;
      const recDate = parsedRec?.date || order.returnDateISO || order.eventDateISO;

      const livExt = `snb_order_${order.orderId}_livraison`;
      const recExt = `snb_order_${order.orderId}_ramassage`;

      // ── Livraison ──
      try {
        const existingLiv = await prisma.pendingPoint.findFirst({ where: { externalId: livExt } });
        if (!existingLiv) {
          await prisma.pendingPoint.create({
            data: {
              date: ensureDateUTC(livDate),
              clientName: order.clientName,
              type: 'livraison',
              produitNom: order.boxType || null,
              source: 'crm_shootnbox',
              externalId: livExt,
              adresse: parsedLiv?.adresse || null,
              creneauDebut: parsedLiv?.creneauDebut || null,
              creneauFin: parsedLiv?.creneauFin || null,
              contactNom: parsedLiv?.contactNom || null,
              contactTelephone: parsedLiv?.contactTelephone || null,
              notes: parsedLiv?.notes || null,
              manuallyEdited: !!form,
            },
          });
          result.created++;
          if (form) result.enriched++;
          console.log(`[CRM PendingPoints] + ${order.clientName} livraison ${livDate}${form ? ' (enrichi)' : ''}`);
        } else if (form && !existingLiv.manuallyEdited && parsedLiv) {
          await prisma.pendingPoint.update({
            where: { id: existingLiv.id },
            data: {
              ...(parsedLiv.adresse && { adresse: parsedLiv.adresse }),
              ...(parsedLiv.creneauDebut && { creneauDebut: parsedLiv.creneauDebut }),
              ...(parsedLiv.creneauFin && { creneauFin: parsedLiv.creneauFin }),
              ...(parsedLiv.contactNom && { contactNom: parsedLiv.contactNom }),
              ...(parsedLiv.contactTelephone && { contactTelephone: parsedLiv.contactTelephone }),
              ...(parsedLiv.notes && { notes: parsedLiv.notes }),
              manuallyEdited: true,
            },
          });
          result.enriched++;
        }
      } catch (e: any) {
        result.errors.push(`Livraison ${order.orderId}: ${e.message}`);
      }

      // ── Ramassage ──
      try {
        const existingRec = await prisma.pendingPoint.findFirst({ where: { externalId: recExt } });
        if (!existingRec) {
          await prisma.pendingPoint.create({
            data: {
              date: ensureDateUTC(recDate),
              clientName: order.clientName,
              type: 'ramassage',
              produitNom: order.boxType || null,
              source: 'crm_shootnbox',
              externalId: recExt,
              adresse: parsedRec?.adresse || null,
              creneauDebut: parsedRec?.creneauDebut || null,
              creneauFin: parsedRec?.creneauFin || null,
              contactNom: parsedRec?.contactNom || null,
              contactTelephone: parsedRec?.contactTelephone || null,
              notes: parsedRec?.notes || null,
              manuallyEdited: !!form,
            },
          });
          result.created++;
          if (form) result.enriched++;
        } else if (form && !existingRec.manuallyEdited && parsedRec) {
          await prisma.pendingPoint.update({
            where: { id: existingRec.id },
            data: {
              ...(parsedRec.adresse && { adresse: parsedRec.adresse }),
              ...(parsedRec.creneauDebut && { creneauDebut: parsedRec.creneauDebut }),
              ...(parsedRec.creneauFin && { creneauFin: parsedRec.creneauFin }),
              ...(parsedRec.contactNom && { contactNom: parsedRec.contactNom }),
              ...(parsedRec.contactTelephone && { contactTelephone: parsedRec.contactTelephone }),
              ...(parsedRec.notes && { notes: parsedRec.notes }),
              manuallyEdited: true,
            },
          });
          result.enriched++;
        }
      } catch (e: any) {
        result.errors.push(`Ramassage ${order.orderId}: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(e.message || 'Erreur inattendue');
  } finally {
    clearTimeout(masterTimeout);
    result.completedAt = new Date().toISOString();
    lastPendingPointsSyncResult = result;
    console.log(`[CRM PendingPoints] Terminé: created=${result.created}, enriched=${result.enriched}, skipped=${result.skipped}, errors=${result.errors.length}`);
  }

  return result;
}

// ─── Cron control ─────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startCrmSync(): void {
  const hasShootnbox = !!(SHOOTNBOX_EMAIL && SHOOTNBOX_PASSWORD);

  if (!hasShootnbox) {
    console.log('[CRM Sync] ShootNBox credentials not configured (CRM_SHOOTNBOX_EMAIL / CRM_SHOOTNBOX_PASSWORD)');
  }

  const brands = [hasShootnbox && 'ShootNBox', 'Smakk'].filter(Boolean).join(' + ');
  const intervalMs = 60 * 60 * 1000;

  setTimeout(async () => {
    try {
      const result = await syncCrmData();
      console.log(
        `[CRM Sync] Initial (${brands}): snb_orders=${result.shootnbox.scrapedOrders}, ` +
        `smakk_orders=${result.smakk.scrapedOrders}, matched=${result.matched}, updated=${result.updated}`
      );
      if (result.errors.length > 0) console.warn('[CRM Sync] Errors:', result.errors);
    } catch (e) {
      console.error('[CRM Sync] Initial sync error:', e);
    }
    // Sync PendingPoints 5s après la sync bookings initiale
    setTimeout(async () => {
      try { await syncCrmPendingPoints(); } catch (e) { console.error('[CRM PendingPoints] Initial error:', e); }
    }, 5_000);
  }, 30_000);

  syncInterval = setInterval(async () => {
    try {
      const result = await syncCrmData();
      console.log(
        `[CRM Sync] Sync (${brands}): snb_orders=${result.shootnbox.scrapedOrders}, ` +
        `smakk_orders=${result.smakk.scrapedOrders}, matched=${result.matched}, updated=${result.updated}`
      );
      if (result.errors.length > 0) console.warn('[CRM Sync] Errors:', result.errors);
    } catch (e) {
      console.error('[CRM Sync] Sync error:', e);
    }
    // PendingPoints sync dans la même fenêtre horaire
    try { await syncCrmPendingPoints(); } catch (e) { console.error('[CRM PendingPoints] Sync error:', e); }
  }, intervalMs);

  console.log(`⏰ CRON: CRM sync (${brands}) + PendingPoints every 60 min`);
}

export function stopCrmSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[CRM Sync] Sync stopped');
  }
}

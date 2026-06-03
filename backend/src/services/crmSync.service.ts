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
const SMAKK_MANAGER_BASE = 'https://www.smakk.fr/manager';
const SMAKK_API_URL = `${SMAKK_MANAGER_BASE}/_otb_orders.php`;
const SMAKK_API_KEY = 'opti2026smk_x7kR9qNv';

const SHOOTNBOX_EMAIL = process.env.CRM_SHOOTNBOX_EMAIL || '';
const SHOOTNBOX_PASSWORD = process.env.CRM_SHOOTNBOX_PASSWORD || '';
const SMAKK_EMAIL = process.env.CRM_SMAKK_EMAIL || '';
const SMAKK_PASSWORD = process.env.CRM_SMAKK_PASSWORD || '';

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
  // Extract all bold text segments from the HTML (company is first <b>, contact is second <b>)
  const boldMatches = [...raw.matchAll(/<b[^>]*>([\s\S]*?)<\/b>/gi)];
  const boldTexts = boldMatches.map(m => stripHtml(m[1] || '').trim()).filter(Boolean);

  if (boldTexts.length >= 2) {
    return [boldTexts[0]!, boldTexts[1]!];
  }
  if (boldTexts.length === 1) {
    return ['', boldTexts[0]!];
  }

  // Fallback: strip full HTML and cut at event metadata
  let text = stripHtml(raw);
  text = text.replace(/Lieu de l.(?:\S+)\s+.vènement.*$/i, '').trim();
  text = text.replace(/Type d.\S+\s+.vènement.*$/i, '').trim();
  return ['', text];
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
      borne: String(row.box_id || ''),  // colonne "N" = numéros de bornes assignées (ex: "V1/P,V2/P,V3/P,V4/P")
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

// ─── Smakk readiness API ─────────────────────────────────────────
// Uses readiness_ajax.php (même format que Shootnbox, accessible sans auth).
// Champs clés : box_id = colonne "N" (IDs bornes ex: "R3/P,S1/P"), delivery = type HTML

async function fetchSmakkReadiness(signal?: AbortSignal): Promise<Map<string, { eventName: string; deliveryType: string; borne: string }>> {
  const map = new Map<string, { eventName: string; deliveryType: string; borne: string }>();
  try {
    const response = await fetch(`${SMAKK_MANAGER_BASE}/readiness_ajax.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'draw=1&start=0&length=500',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return map;
    const data = await response.json() as any;
    const rows: any[] = data.aaData || data.data || [];
    for (const row of rows) {
      const id = String(row.id || '').trim();
      if (!id) continue;
      // box_id = colonne "N" = IDs de bornes assignées (ex: "R3/P" ou "S1/P,S2/P")
      const borne = String(row.box_id || '').trim();
      // delivery = HTML du type de livraison (ex: "<center...>Livraison</center>")
      const deliveryType = stripHtml(String(row.delivery || '')).trim();
      // Pas de nom_event dans readiness_ajax.php — utiliser societe comme fallback
      const eventName = '';
      map.set(id, { eventName, deliveryType, borne });
    }
  } catch {
    // Endpoint optionnel — pas bloquant
  }
  return map;
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
// Filtre : delivery == "Livraison" ET box_type != "Vegas Slim" / "Smakk Slim"
// Les informations de livraison viennent du formulaire mail-info-client (otb_cfg_bulk.php)

// Mapping CRM box_type → OptiTour produitNom
const CRM_BOX_TYPE_MAP: Record<string, string> = {
  'karaoké': 'Playbox',  // "Karaoké" dans Shootnbox manager2
  'karaoke':     'Playbox',
  'playbox':     'Playbox',
  'vegas':       'Vegas',
  'ring':        'Ring',
  'smakk':       'Smakk',
  'miroir':      'Miroir',
  'spinner':     'Spinner',
  'aircam':      'Aircam',
};

function normalizeBoxType(raw: string): string {
  const key = raw.toLowerCase().trim();
  return CRM_BOX_TYPE_MAP[key] ?? raw;
}

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
    : isRec
      ? null  // ramassage sans adresse recup distincte → null, pas copie de la livraison
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

// Parse Smakk créneau "9h30 - 14h" or "10H-13H" → ["09:30", "14:00"]
function parseSmakkCreneau(raw: string): [string | null, string | null] {
  const cren = pendingParseCreneau(raw);
  if (cren) return [cren.debut, cren.fin];
  return [null, null];
}

// ─── Smakk Info Client (mail-infos-smk.php) ──────────────────────
// Données remplies par le client quand il répond au mail info logistique.
// Source de vérité prioritaire sur _otb_orders.php pour les dates et l'adresse.

interface SmakkInfoClient {
  logType: 'livraison' | 'retrait' | 'chronopost' | null;
  adresse: string | null;       // adresse de livraison
  recAdresse: string | null;    // adresse de récupération (si distincte)
  livDateISO: string | null;
  livCreneauDebut: string | null;
  livCreneauFin: string | null;
  recDateISO: string | null;
  recCreneauDebut: string | null;
  recCreneauFin: string | null;
  contactNom: string | null;
  contactTelephone: string | null;
}

function parseDateDDMMYYYY(dateStr: string): string | null {
  const m = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

function parseSmakkInfoClientHtml(html: string): SmakkInfoClient {
  const result: SmakkInfoClient = {
    logType: null,
    adresse: null, recAdresse: null, livDateISO: null, livCreneauDebut: null, livCreneauFin: null,
    recDateISO: null, recCreneauDebut: null, recCreneauFin: null,
    contactNom: null, contactTelephone: null,
  };
  if (!html) return result;

  const rows = [...html.matchAll(/<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>/gis)];
  for (const [, rawLabel, rawValue] of rows) {
    const label = (rawLabel || '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '').trim().toLowerCase();
    const value = (rawValue || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&[^;]+;/g, '').trim();
    if (!label || !value) continue;

    const v = value.toLowerCase();
    if (label === 'type') {
      // "Retrait boutique — adresse" or "Livraison — adresse"
      if (v.includes('retrait')) result.logType = 'retrait';
      else if (v.includes('chronopost') || v.includes('tnt')) result.logType = 'chronopost';
      else if (v.includes('livraison')) result.logType = 'livraison';
    } else if (label.includes('adresse') && label.includes('cup')) {
      // "Adresse récupération" → adresse de ramassage distincte
      result.recAdresse = value;
    } else if (label.includes('adresse')) {
      // "Adresse" (sans "récupération") → adresse de livraison
      result.adresse = value;
      if (!result.logType) result.logType = 'livraison'; // champ adresse implique livraison
    } else if (label.includes('jour') && label.includes('livraison')) {
      result.livDateISO = parseDateDDMMYYYY(value);
    } else if (label.includes('livraison') && label.includes('cr') && label.includes('neau')) {
      [result.livCreneauDebut, result.livCreneauFin] = parseSmakkCreneau(value);
    } else if (label.includes('jour') && label.includes('cup')) {
      result.recDateISO = parseDateDDMMYYYY(value);
    } else if (label.includes('cup') && label.includes('cr') && label.includes('neau')) {
      [result.recCreneauDebut, result.recCreneauFin] = parseSmakkCreneau(value);
    } else if (label.includes('contact sur place')) {
      // "Karim — 0644250127" or "Clara vello — 0672742769"
      const parts = value.split(/\s*[—–]\s*/);
      result.contactNom = parts[0]?.trim() || null;
      result.contactTelephone = parts[1]?.trim() || null;
    }
  }
  return result;
}

async function fetchSmakkInfoClients(
  cookie: string,
  orderIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, SmakkInfoClient>> {
  const map = new Map<string, SmakkInfoClient>();
  for (const orderId of orderIds) {
    try {
      const resp = await fetch(
        `${SMAKK_MANAGER_BASE}/mail-infos-smk.php?ajax=get_responses&order_id=${orderId}`,
        { headers: { Cookie: cookie }, signal },
      );
      if (!resp.ok) continue;
      const data = await resp.json() as any;
      if (!data.html) continue;
      map.set(orderId, parseSmakkInfoClientHtml(data.html));
    } catch {
      // ordre sans réponse ou erreur réseau → fallback sur _otb_orders.php
    }
  }
  return map;
}

export interface PendingPointsSyncResult {
  created: number;
  enriched: number;
  skipped: number;
  autoDispatched: number;
  clientsBackfilled?: number;
  errors: string[];
  completedAt?: string;
}

// ─── Back-fill contact → fiche Client ─────────────────────────────
// La copie contact (nom + tél) vers la fiche Client ne se fait qu'au moment du
// dispatch (autodispatch.service). Si un événement est dispatché AVANT que le
// client remplisse son formulaire info-logistique, sa fiche Client reste sans
// contact, même quand le pending_point récupère l'info au sync suivant.
// Ce back-fill propage le contact des pending_points vers la fiche Client
// correspondante (match par nom/société), pour Shootnbox ET Smakk. On ne remplit
// que les champs VIDES → jamais d'écrasement d'une saisie manuelle.
async function backfillClientContacts(result: PendingPointsSyncResult): Promise<void> {
  const pts = await prisma.pendingPoint.findMany({
    where: {
      deletedByUser: false,
      OR: [{ contactNom: { not: null } }, { contactTelephone: { not: null } }],
    },
    select: { clientName: true, contactNom: true, contactTelephone: true },
  });

  // Dédupe par nom de client (on agrège le 1er contact non vide trouvé)
  const byName = new Map<string, { clientName: string; contactNom: string | null; contactTelephone: string | null }>();
  for (const p of pts) {
    const key = (p.clientName || '').trim().toLowerCase();
    if (!key) continue;
    const cur = byName.get(key) || { clientName: p.clientName, contactNom: null, contactTelephone: null };
    if (!cur.contactNom && p.contactNom) cur.contactNom = p.contactNom;
    if (!cur.contactTelephone && p.contactTelephone) cur.contactTelephone = p.contactTelephone;
    byName.set(key, cur);
  }

  let filled = 0;
  for (const v of byName.values()) {
    const nameMatch = {
      OR: [
        { nom: { equals: v.clientName, mode: 'insensitive' as const } },
        { societe: { equals: v.clientName, mode: 'insensitive' as const } },
      ],
    };
    if (v.contactNom) {
      const r = await prisma.client.updateMany({
        where: { AND: [nameMatch, { OR: [{ contactNom: null }, { contactNom: '' }] }] },
        data: { contactNom: v.contactNom },
      });
      filled += r.count;
    }
    if (v.contactTelephone) {
      await prisma.client.updateMany({
        where: { AND: [nameMatch, { OR: [{ contactTelephone: null }, { contactTelephone: '' }] }] },
        data: { contactTelephone: v.contactTelephone },
      });
    }
  }

  result.clientsBackfilled = filled;
  if (filled > 0) console.log(`[CRM PendingPoints] Back-fill contacts → ${filled} fiche(s) Client complétée(s)`);
}

export let lastPendingPointsSyncResult: PendingPointsSyncResult | null = null;

export async function syncCrmPendingPoints(): Promise<PendingPointsSyncResult> {
  const result: PendingPointsSyncResult = { created: 0, enriched: 0, skipped: 0, autoDispatched: 0, errors: [] };

  if (!SHOOTNBOX_EMAIL || !SHOOTNBOX_PASSWORD) {
    result.errors.push('ShootNBox credentials non configurés');
    return result;
  }

  const controller = new AbortController();
  const masterTimeout = setTimeout(() => controller.abort(new Error('syncCrmPendingPoints timeout (60s)')), 60_000);

  try {
    // Étape 0 supprimée : le CRM est désormais la source de vérité — on ne supprime plus
    // les points CRM quand un point Google Calendar existe sur la même date.

    // 1. Login ShootNBox
    const cookie = await crmLogin(SHOOTNBOX_BASE, SHOOTNBOX_EMAIL, SHOOTNBOX_PASSWORD, 'ShootNBox PendingPoints', controller.signal);

    // 1b. Readiness map → eventName (nom d'événement pour la page Préparations)
    const readinessMap = await scrapeShootnboxReadiness(cookie, controller.signal);
    console.log(`[CRM PendingPoints] ${readinessMap.size} entrées readiness (noms d'événements)`);

    // 2. Formulaires mail-info-client soumis — fetch AVANT le filtre orders pour pouvoir
    //    utiliser logType comme fallback quand le champ delivery d'orders_ajax est vide.
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

    // 3. Récupérer les commandes actuelles et archivées : delivery=Livraison, box_type!=Vegas Slim
    // Fallback : si delivery est vide dans orders_ajax mais que le formulaire client indique
    // logType=classique (ni chronopost ni retrait), on inclut quand même la commande.
    const PAGE_SIZE = 500;
    const eligible: Array<{
      orderId: string; numId: string | null; clientName: string;
      boxType: string; eventDateISO: string; returnDateISO: string | null;
    }> = [];

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    for (const urlSuffix of ['orders_ajax.php?status=2', 'orders_ajax.php?status=2&arch=true']) {
      let start = 0;
      let total = 0;
      do {
        const { rows, totalFiltered } = await fetchOrdersPage(
          cookie, `${SHOOTNBOX_BASE}/${urlSuffix}`, start, PAGE_SIZE, controller.signal
        );
        if (rows.length === 0) break;
        total = totalFiltered;

        for (const row of rows) {
          const deliveryVal = stripHtml(String(row.delivery || '')).toLowerCase();
          const rawBoxType = stripHtml(String(row.box_type || ''));
          const orderId = String(row.id || '').trim();
          const numIdMatch = stripHtml(String(row.facture || '')).match(/FA\d+/);
          const numId = numIdMatch ? numIdMatch[0] : null;
          const debugId = numId || orderId || '?';

          // Exclure explicitement Retrait et Chronopost
          if (deliveryVal.includes('retrait') || deliveryVal.includes('chronopost')) {
            console.log(`[CRM PendingPoints] SKIP ${debugId} — retrait/chronopost: "${deliveryVal}"`);
            continue;
          }

          // Filtre positif sur delivery — OU fallback sur logType du formulaire client
          const form = numId ? formByNumId.get(numId) : undefined;
          const deliveryOk = deliveryVal.includes('livraison') || deliveryVal.includes('installation');
          const formOk = form && form.logType !== 'chronopost' && form.logType !== 'retrait';
          if (!deliveryOk && !formOk) {
            console.log(`[CRM PendingPoints] SKIP ${debugId} — delivery non éligible: "${deliveryVal}" (pas de formulaire client éligible)`);
            continue;
          }
          if (!deliveryOk && formOk) {
            console.log(`[CRM PendingPoints] INCLUDE ${debugId} — delivery vide mais formulaire client logType="${form!.logType}"`);
          }

          if (rawBoxType === 'Vegas Slim') continue;
          if (!orderId) continue;

          const eventDateISO = pendingDateDMY(stripHtml(String(row.event_date || '')));
          if (!eventDateISO) {
            console.log(`[CRM PendingPoints] SKIP ${debugId} — date non parseable: "${row.event_date}"`);
            continue;
          }

          // Only upcoming events (event_date >= today)
          if (new Date(eventDateISO) < today) continue;

          // Deduplicate across both URL passes
          if (eligible.some(e => e.orderId === orderId)) continue;

          const [company, contactName] = parseCustomerField(String(row.customer || ''));
          const clientName = company || contactName || `Commande ${orderId}`;
          const boxType = normalizeBoxType(rawBoxType);
          const returnDateISO = pendingDateDMY(stripHtml(String(row.return_date || '')));

          eligible.push({ orderId, numId, clientName, boxType, eventDateISO, returnDateISO });
        }
        start += PAGE_SIZE;
      } while (start < total);
    }

    console.log(`[CRM PendingPoints] ${eligible.length} commandes éligibles (Livraison, hors Vegas Slim)`);

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

      const readinessEntry = readinessMap.get(order.orderId);
      const eventName = readinessEntry?.eventName || null;
      const borneRaw = readinessEntry?.borne || '';
      const quantiteBornes = borneRaw ? borneRaw.split(',').filter(Boolean).length : 1;

      // ── Livraison ──
      try {
        const existingLiv = await prisma.pendingPoint.findFirst({ where: { externalId: livExt } });
        if (!existingLiv) {
          await prisma.pendingPoint.create({
            data: {
              date: ensureDateUTC(livDate),
              clientName: order.clientName,
              eventName,
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
              quantiteBornes,
              // manuallyEdited réservé aux éditions via l'UI (PATCH). Le sync ne le
              // pose jamais → le formulaire client reste re-synchronisable.
              manuallyEdited: false,
            },
          });
          result.created++;
          if (form) result.enriched++;
          console.log(`[CRM PendingPoints] + ${order.clientName}${eventName ? ` (${eventName})` : ''} livraison ${livDate} (×${quantiteBornes})`);
        } else {
          await prisma.pendingPoint.update({
            where: { id: existingLiv.id },
            data: {
              clientName: order.clientName,
              ...(eventName && { eventName }),
              quantiteBornes,
              // Re-synchroniser depuis le CRM/formulaire à CHAQUE sync tant que le
              // point n'a pas été édité manuellement via l'UI. Si le client met à
              // jour son formulaire dans manager2, OptiTour suit automatiquement.
              ...(!existingLiv.manuallyEdited && { date: ensureDateUTC(livDate) }),
              ...(form && parsedLiv?.adresse && { adresse: parsedLiv.adresse }),
              ...(!existingLiv.manuallyEdited && form && parsedLiv && {
                ...(parsedLiv.creneauDebut && { creneauDebut: parsedLiv.creneauDebut }),
                ...(parsedLiv.creneauFin && { creneauFin: parsedLiv.creneauFin }),
                ...(parsedLiv.contactNom && { contactNom: parsedLiv.contactNom }),
                ...(parsedLiv.contactTelephone && { contactTelephone: parsedLiv.contactTelephone }),
                ...(parsedLiv.notes && { notes: parsedLiv.notes }),
              }),
            },
          });
          if (form && parsedLiv) result.enriched++;
        }
      } catch (e: any) {
        result.errors.push(`Livraison ${order.orderId}: ${e.message}`);
      }

      // ── Ramassage ──
      try {
        const existingRec = await prisma.pendingPoint.findFirst({ where: { externalId: recExt } });
        if (!existingRec) {
          {
            await prisma.pendingPoint.create({
              data: {
                date: ensureDateUTC(recDate),
                clientName: order.clientName,
                eventName,
                type: 'ramassage',
                produitNom: order.boxType || null,
                source: 'crm_shootnbox',
                externalId: recExt,
                adresse: parsedRec?.adresse ?? parsedLiv?.adresse ?? null,
                creneauDebut: parsedRec?.creneauDebut || null,
                creneauFin: parsedRec?.creneauFin || null,
                contactNom: parsedRec?.contactNom || null,
                contactTelephone: parsedRec?.contactTelephone || null,
                notes: parsedRec?.notes || null,
                quantiteBornes,
                // manuallyEdited réservé aux éditions UI — pas posé par le sync.
                manuallyEdited: false,
              },
            });
            result.created++;
            if (form) result.enriched++;
            console.log(`[CRM PendingPoints] + ${order.clientName}${eventName ? ` (${eventName})` : ''} ramassage ${recDate} (×${quantiteBornes})`);
          }
        } else {
          await prisma.pendingPoint.update({
            where: { id: existingRec.id },
            data: {
              clientName: order.clientName,
              ...(eventName && { eventName }),
              quantiteBornes,
              // Re-sync depuis le CRM/formulaire à chaque passage tant que non édité via l'UI.
              ...(!existingRec.manuallyEdited && { date: ensureDateUTC(recDate) }),
              ...(form && parsedRec?.adresse && { adresse: parsedRec.adresse }),
              ...(!existingRec.manuallyEdited && form && parsedRec && {
                ...(parsedRec.creneauDebut && { creneauDebut: parsedRec.creneauDebut }),
                ...(parsedRec.creneauFin && { creneauFin: parsedRec.creneauFin }),
                ...(parsedRec.contactNom && { contactNom: parsedRec.contactNom }),
                ...(parsedRec.contactTelephone && { contactTelephone: parsedRec.contactTelephone }),
                ...(parsedRec.notes && { notes: parsedRec.notes }),
              }),
            },
          });
          if (form && parsedRec) result.enriched++;
        }
      } catch (e: any) {
        result.errors.push(`Ramassage ${order.orderId}: ${e.message}`);
      }
    }

    // Nettoyage : supprimer les pending_points crm_shootnbox dont l'orderId n'est
    // plus dans la liste éligible (commande passée en demande/retrait, annulée ou
    // supprimée du CRM). Garde-fou : on ne touche QUE les points non-dispatchés et
    // non supprimés manuellement — un point déjà placé dans une tournée (un humain
    // l'a validé) est conservé.
    try {
      const eligibleSnbOrderIds = new Set(eligible.map(o => o.orderId));
      const existingSnbPts = await prisma.pendingPoint.findMany({
        where: { source: 'crm_shootnbox', date: { gte: today }, dispatched: false, deletedByUser: false },
        select: { id: true, externalId: true },
      });
      for (const pt of existingSnbPts) {
        if (!pt.externalId) continue;
        const match = pt.externalId.match(/^snb_order_(\d+)_/);
        if (!match || !match[1]) continue;
        if (!eligibleSnbOrderIds.has(match[1])) {
          await prisma.pendingPoint.delete({ where: { id: pt.id } });
          console.log(`[CRM PendingPoints] - supprimé (commande non éligible) externalId=${pt.externalId}`);
        }
      }
    } catch (e: any) {
      result.errors.push(`Nettoyage Shootnbox: ${e.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SMAKK CRM → PendingPoints
    // Source: _otb_orders.php (direct DB query via smakk.fr/manager/)
    // Inclut: Livraison + Installation, hors Retrait boutique
    // Données directement dans orders_new: adresse, créneau, contact
    // ═══════════════════════════════════════════════════════════════

    // Nettoyage Calendar Smakk supprimé : le CRM est désormais la source de vérité.

    // A2. Readiness Smakk → eventName
    const smakkReadinessMap = await fetchSmakkReadiness(controller.signal);
    console.log(`[CRM PendingPoints Smakk] ${smakkReadinessMap.size} entrées readiness`);

    // B. Fetch Smakk orders
    const SMK_PAGE_SIZE = 500;
    const smakkEligible: Array<{
      orderId: string; clientName: string; boxType: string;
      livDateISO: string; recDateISO: string;
      adresse: string | null; phone: string | null;
      takeContact: string | null; returnContact: string | null;
      creneauDebutLiv: string | null; creneauFinLiv: string | null;
      creneauDebutRec: string | null; creneauFinRec: string | null;
    }> = [];

    let smkPage = 0; let smkTotal = 0;
    do {
      const smkUrl = `${SMAKK_API_URL}?key=${SMAKK_API_KEY}&page=${smkPage}&size=${SMK_PAGE_SIZE}`;
      const smkResp = await fetch(smkUrl, { signal: controller.signal });
      if (!smkResp.ok) throw new Error(`Smakk API HTTP ${smkResp.status}`);
      const smkData = await smkResp.json() as any;
      smkTotal = smkData.total || 0;
      const smkRows: any[] = smkData.data || [];
      if (smkRows.length === 0) break;

      for (const row of smkRows) {
        const delivOpts = (row.delivery_options || '').toLowerCase();
        const orderId = String(row.id || '').trim();

        // Exclure explicitement Retrait, Chronopost et livraisons transporteur (TNT, Colissimo)
        if (delivOpts.includes('retrait') || delivOpts.includes('chronopost') || delivOpts.includes('tnt') || delivOpts.includes('colissimo')) {
          result.skipped++;
          continue;
        }

        // Filtre positif sur delivery_options — OU fallback sur take_date renseigné
        // Si delivery_options est vide mais qu'une date de livraison est planifiée → livraison
        const deliveryOk = delivOpts.includes('livraison') || delivOpts.includes('installation');
        const takeDateSet = !!(row.take_date || '').trim();
        if (!deliveryOk && !takeDateSet) {
          result.skipped++;
          continue;
        }
        if (!deliveryOk && takeDateSet) {
          console.log(`[CRM PendingPoints Smakk] INCLUDE ${orderId} — delivery_options vide mais take_date renseigné`);
        }

        // Exclure Smakk Slim (pas géré par les chauffeurs OptiTour)
        if ((row.box_type || '').trim() === 'Smakk Slim') {
          result.skipped++;
          continue;
        }

        // Date de livraison : take_date en priorité, sinon event_date
        const livDateRaw = (row.take_date || '').trim() || (row.event_date || '').trim();
        const livDateISO = pendingDateDMY(livDateRaw);
        if (!livDateISO) continue;
        if (new Date(livDateISO) < today) continue;

        // Date de ramassage : return_date, sinon livraison
        const recDateISO = pendingDateDMY((row.return_date || '').trim()) || livDateISO;

        const company = (row.company || '').trim();
        const contact = [(row.first_name || '').trim(), (row.last_name || '').trim()].filter(Boolean).join(' ');
        const clientName = company || contact || `Smakk ${row.id}`;

        // Adresse : address + cp + city
        const adresseParts = [
          (row.address || '').trim(),
          [(row.cp || '').trim(), (row.city || '').trim()].filter(Boolean).join(' '),
        ].filter(Boolean);
        const adresse = adresseParts.join(', ') || null;

        // Créneaux : parser "9h30 - 14h" → { debut, fin }
        const [cdLiv, cfLiv] = parseSmakkCreneau((row.take_time || '').trim());
        const [cdRec, cfRec] = parseSmakkCreneau((row.return_time || '').trim());

        smakkEligible.push({
          orderId: String(row.id),
          clientName,
          boxType: (row.box_type || '').trim(),
          livDateISO,
          recDateISO,
          adresse,
          phone: (row.phone || '').trim() || null,
          takeContact: (row.take_contact || '').trim() || null,
          returnContact: (row.return_contact || '').trim() || null,
          creneauDebutLiv: cdLiv,
          creneauFinLiv: cfLiv,
          creneauDebutRec: cdRec,
          creneauFinRec: cfRec,
        });
      }

      smkPage++;
    } while (smkPage * SMK_PAGE_SIZE < smkTotal);

    console.log(`[CRM PendingPoints Smakk] ${smakkEligible.length} commandes éligibles (Livraison, hors Retrait/Chronopost)`);

    // A3. Login Smakk manager → récupérer les réponses "Info client" (mail-infos-smk.php)
    // Ces réponses sont la source de vérité : dates réelles, adresse, contact, créneaux.
    let smakkInfoClientMap = new Map<string, SmakkInfoClient>();
    if (SMAKK_EMAIL && SMAKK_PASSWORD) {
      try {
        const smakkCookie = await crmLogin(SMAKK_MANAGER_BASE, SMAKK_EMAIL, SMAKK_PASSWORD, 'Smakk InfoClient', controller.signal);
        smakkInfoClientMap = await fetchSmakkInfoClients(smakkCookie, smakkEligible.map(o => o.orderId), controller.signal);
        console.log(`[CRM PendingPoints Smakk] ${smakkInfoClientMap.size} réponse(s) info client trouvée(s)`);
      } catch (e: any) {
        console.warn(`[CRM PendingPoints Smakk] Info client login/fetch failed: ${e.message}`);
      }
    } else {
      console.warn('[CRM PendingPoints Smakk] CRM_SMAKK_EMAIL/PASSWORD non configurés — info client ignoré');
    }

    // Nettoyage : supprimer les pending_points crm_smakk dont le orderId n'est plus éligible
    const eligibleOrderIds = new Set(smakkEligible.map(o => o.orderId));
    const existingSmakkPts = await prisma.pendingPoint.findMany({
      where: { source: 'crm_smakk', date: { gte: today } },
      select: { id: true, externalId: true },
    });
    for (const pt of existingSmakkPts) {
      if (!pt.externalId) continue;
      const match = pt.externalId.match(/^smk_order_(\d+)_/);
      if (!match || !match[1]) continue;
      const orderId = match[1];
      if (!eligibleOrderIds.has(orderId)) {
        await prisma.pendingPoint.delete({ where: { id: pt.id } });
        console.log(`[CRM PendingPoints Smakk] - supprimé retrait/inéligible externalId=${pt.externalId}`);
      }
    }

    // C. Créer / mettre à jour les PendingPoints Smakk
    for (const order of smakkEligible) {
      const livExt = `smk_order_${order.orderId}_livraison`;
      const recExt = `smk_order_${order.orderId}_ramassage`;

      const readinessEntry = smakkReadinessMap.get(order.orderId);
      const smkEventName = readinessEntry?.eventName || null;
      const smkBorneRaw = readinessEntry?.borne || '';
      const smkQuantiteBornes = smkBorneRaw ? smkBorneRaw.split(',').filter(Boolean).length : 1;

      // Filtre colonne "Livraison" de readiness.php
      if (readinessEntry && readinessEntry.deliveryType) {
        const dt = readinessEntry.deliveryType.toLowerCase();
        if (!dt.includes('livraison') && !dt.includes('installation')) {
          result.skipped++;
          continue;
        }
      }

      // Merge : info client (réponse mail) prioritaire sur _otb_orders.php
      const ic = smakkInfoClientMap.get(order.orderId);
      if (ic?.logType === 'retrait' || ic?.logType === 'chronopost') {
        result.skipped++;
        continue;
      }
      const hasInfoClient = !!ic && (!!ic.adresse || !!ic.livCreneauDebut || !!ic.livDateISO);
      const livDateISO = ic?.livDateISO || order.livDateISO;
      const recDateISO = ic?.recDateISO || order.recDateISO;
      const adresse = ic?.adresse || order.adresse;                 // adresse livraison
      const recAdresse = ic?.recAdresse || ic?.adresse || order.adresse; // adresse récup (fallback sur livraison)
      const contactNom = ic?.contactNom || order.takeContact;
      const contactTelephone = ic?.contactTelephone || order.phone;
      const creneauDebutLiv = ic?.livCreneauDebut || order.creneauDebutLiv;
      const creneauFinLiv = ic?.livCreneauFin || order.creneauFinLiv;
      const creneauDebutRec = ic?.recCreneauDebut || order.creneauDebutRec;
      const creneauFinRec = ic?.recCreneauFin || order.creneauFinRec;
      const contactNomRec = ic?.contactNom || order.returnContact || order.takeContact;

      // ── Livraison Smakk ──
      try {
        const existingLiv = await prisma.pendingPoint.findFirst({ where: { externalId: livExt } });
        if (!existingLiv) {
          await prisma.pendingPoint.create({ data: {
            date: ensureDateUTC(livDateISO),
            clientName: order.clientName,
            eventName: smkEventName,
            type: 'livraison',
            produitNom: order.boxType || null,
            source: 'crm_smakk',
            externalId: livExt,
            adresse,
            creneauDebut: creneauDebutLiv,
            creneauFin: creneauFinLiv,
            contactNom,
            contactTelephone,
            quantiteBornes: smkQuantiteBornes,
            // manuallyEdited réservé aux éditions UI — pas posé par le sync.
            manuallyEdited: false,
          }});
          result.created++;
          console.log(`[CRM PendingPoints Smakk] + ${order.clientName}${smkEventName ? ` (${smkEventName})` : ''} livraison ${livDateISO} (×${smkQuantiteBornes})${ic ? ' (info client)' : ''}`);
        } else {
          await prisma.pendingPoint.update({ where: { id: existingLiv.id }, data: {
            clientName: order.clientName,
            ...(smkEventName && { eventName: smkEventName }),
            quantiteBornes: smkQuantiteBornes,
            // Re-sync depuis le CRM/info client à chaque passage tant que non édité via l'UI.
            ...(!existingLiv.manuallyEdited && {
              date: ensureDateUTC(livDateISO),
              adresse,
              creneauDebut: creneauDebutLiv,
              creneauFin: creneauFinLiv,
              contactNom,
              contactTelephone,
            }),
          }});
          if (!existingLiv.manuallyEdited && hasInfoClient) result.enriched++;
        }
      } catch (e: any) { result.errors.push(`Smakk livraison ${order.orderId}: ${e.message}`); }

      // ── Ramassage Smakk ──
      try {
        const existingRec = await prisma.pendingPoint.findFirst({ where: { externalId: recExt } });
        if (!existingRec) {
          await prisma.pendingPoint.create({ data: {
            date: ensureDateUTC(recDateISO),
            clientName: order.clientName,
            eventName: smkEventName,
            type: 'ramassage',
            produitNom: order.boxType || null,
            source: 'crm_smakk',
            externalId: recExt,
            adresse: recAdresse,
            creneauDebut: creneauDebutRec,
            creneauFin: creneauFinRec,
            contactNom: contactNomRec,
            contactTelephone,
            quantiteBornes: smkQuantiteBornes,
            // manuallyEdited réservé aux éditions UI — pas posé par le sync.
            manuallyEdited: false,
          }});
          result.created++;
          console.log(`[CRM PendingPoints Smakk] + ${order.clientName}${smkEventName ? ` (${smkEventName})` : ''} ramassage ${recDateISO} (×${smkQuantiteBornes})${ic ? ' (info client)' : ''}`);
        } else {
          await prisma.pendingPoint.update({ where: { id: existingRec.id }, data: {
            clientName: order.clientName,
            ...(smkEventName && { eventName: smkEventName }),
            quantiteBornes: smkQuantiteBornes,
            // Re-sync depuis le CRM/info client à chaque passage tant que non édité via l'UI.
            ...(!existingRec.manuallyEdited && {
              date: ensureDateUTC(recDateISO),
              adresse: recAdresse,
              creneauDebut: creneauDebutRec,
              creneauFin: creneauFinRec,
              contactNom: contactNomRec,
              contactTelephone,
            }),
          }});
          if (!existingRec.manuallyEdited && hasInfoClient) result.enriched++;
        }
      } catch (e: any) { result.errors.push(`Smakk ramassage ${order.orderId}: ${e.message}`); }
    }

    // Back-fill : propager les contacts des pending_points vers les fiches Client
    // dont le contact est encore vide (events dispatchés avant réponse au formulaire).
    await backfillClientContacts(result);

  } catch (e: any) {
    result.errors.push(e.message || 'Erreur inattendue');
  }

  clearTimeout(masterTimeout);
  result.completedAt = new Date().toISOString();
  lastPendingPointsSyncResult = result;
  console.log(`[CRM PendingPoints] Terminé: created=${result.created}, enriched=${result.enriched}, skipped=${result.skipped}, autoDispatched=${result.autoDispatched}, backfilled=${result.clientsBackfilled ?? 0}, errors=${result.errors.length}`);

  return result;
}

// ─── Déclenchement temps réel (webhook CRM) ──────────────────────
// Le CRM (Shootnbox/Smakk) appelle POST /api/pending-points/crm-webhook dès qu'une
// info est créée/modifiée → on synchronise sans attendre le cron horaire.
//
// Garde-fous :
//  - Verrou : un seul syncCrmPendingPoints() à la fois (les appels concurrents
//    ne relancent pas un 2e scrape lourd).
//  - Débounce : si plusieurs webhooks arrivent en rafale (ex. 10 clients en même
//    temps), on coalesce en une seule sync planifiée ~3s plus tard.
//  - Coalescing : si un webhook arrive pendant une sync en cours, on en replanifie
//    une juste après (pour capter l'info arrivée trop tard dans le scrape courant).

let syncInProgress = false;
let pendingRerun = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const WEBHOOK_DEBOUNCE_MS = 3_000;

async function runPendingPointsSyncGuarded(reason: string): Promise<void> {
  if (syncInProgress) {
    // Une sync tourne déjà → marquer qu'il faut la relancer après pour capter
    // l'info qui vient d'arriver.
    pendingRerun = true;
    return;
  }
  syncInProgress = true;
  try {
    console.log(`[CRM Webhook] Sync déclenchée (${reason})`);
    await syncCrmPendingPoints();
  } catch (e) {
    console.error('[CRM Webhook] Sync error:', e);
  } finally {
    syncInProgress = false;
    if (pendingRerun) {
      pendingRerun = false;
      // Relance immédiate (sans débounce) pour traiter ce qui est arrivé pendant.
      void runPendingPointsSyncGuarded('rerun post-sync');
    }
  }
}

/**
 * Appelé par le webhook CRM. Ne bloque pas l'appelant : planifie une sync
 * débouncée et répond tout de suite. Retourne immédiatement.
 */
export function triggerCrmSyncDebounced(reason = 'webhook'): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runPendingPointsSyncGuarded(reason);
  }, WEBHOOK_DEBOUNCE_MS);
}

// ─── Cron control ─────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startCrmSync(): void {
  const hasShootnbox = !!(SHOOTNBOX_EMAIL && SHOOTNBOX_PASSWORD);

  if (!hasShootnbox) {
    console.log('[CRM Sync] ShootNBox credentials not configured (CRM_SHOOTNBOX_EMAIL / CRM_SHOOTNBOX_PASSWORD)');
  }

  const brands = [hasShootnbox && 'ShootNBox', 'Smakk'].filter(Boolean).join(' + ');
  // Filet de sécurité : polling court (10 min) au cas où un webhook CRM se perd.
  // Le temps réel est assuré par le webhook (triggerCrmSyncDebounced).
  const intervalMs = 10 * 60 * 1000;
  // La sync bookings (emails/photos) reste horaire — elle est lourde et non liée
  // aux points à dispatcher. On ne la passe pas à 10 min.
  const bookingsSyncEveryNTicks = 6; // 6 × 10 min = 60 min
  let tick = 0;

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
    tick++;
    // Sync bookings (emails/photos) seulement toutes les 60 min (lourde).
    if (tick % bookingsSyncEveryNTicks === 0) {
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
    }
    // PendingPoints sync toutes les 10 min (filet de sécurité du webhook),
    // via le même verrou pour ne pas chevaucher un sync déclenché par webhook.
    await runPendingPointsSyncGuarded('cron 10min');
  }, intervalMs);

  console.log(`⏰ CRON: PendingPoints every 10 min (filet webhook) + bookings every 60 min — ${brands}`);
}

export function stopCrmSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[CRM Sync] Sync stopped');
  }
}

// ─── Readiness events (page Préparations) ─────────────────────────
// Source unique des menus déroulants "Choisir un événement" : la table
// readiness.php des DEUX CRM (readiness_ajax.php). On lit la colonne "Borne"
// (type de borne) pour aiguiller chaque événement vers la bonne fiche, et la
// colonne "Nom d'Event" (nom_event chez Shootnbox, societe chez Smakk).
// Le n° FA n'est pas importé. Toutes les commandes sont incluses (livraison +
// retrait), conformément au besoin métier (on prépare la borne dans tous les cas).

export interface ReadinessEvent {
  id: string;                 // `rdy_<brand>_<orderId>` — stocké dans Preparation.pendingPointId
  orderId: string;
  brand: 'shootnbox' | 'smakk';
  date: string;               // ISO yyyy-mm-dd
  clientName: string;
  eventName: string | null;
  produitNom: string | null;  // type normalisé (Vegas, VegasSlim, Smakk, Ring, ...)
  boxIds: string;             // colonne "N" (ex: "V1/P,V2/P")
}

// Colonne "Borne" du CRM → type OptiTour. Vegas Slim + Smakk Slim → VegasSlim.
const READINESS_TYPE_MAP: Record<string, string> = {
  'vegas': 'Vegas',
  'vegas slim': 'VegasSlim',
  'smakk': 'Smakk',
  'smakk slim': 'VegasSlim',
  'ring': 'Ring',
  'miroir': 'Miroir',
  'playbox': 'Playbox',
  'karaoké': 'Playbox',
  'karaoke': 'Playbox',
  'aircam': 'Aircam',
  'spinner': 'Spinner',
};

function normalizeReadinessType(raw: string): string | null {
  const clean = stripHtml(String(raw || '')).trim();
  if (!clean) return null;
  return READINESS_TYPE_MAP[clean.toLowerCase()] ?? clean;
}

// "01.06.2026<br />ID 3574" → "2026-06-01"
function parseReadinessDate(raw: string): string | null {
  const m = stripHtml(String(raw || '')).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

function parseReadinessRows(rows: any[], brand: 'shootnbox' | 'smakk'): ReadinessEvent[] {
  const events: ReadinessEvent[] = [];
  for (const row of rows) {
    const orderId = stripHtml(String(row.id || '')).trim();
    if (!orderId) continue;

    const date = parseReadinessDate(String(row.date || ''));
    if (!date) continue;

    const produitNom = normalizeReadinessType(String(row.borne || ''));

    // Colonne "Nom d'Event". Shootnbox y concatène "<date> <client> <FA>"
    // (ex: "06.06.2026 Soumeillan Célyne FA14034") → on retire la date en
    // préfixe et le n° FA en suffixe pour ne garder que le nom du client.
    const rawEventName = stripHtml(String(row.nom_event || '')).trim();
    const clientFromEvent = rawEventName
      .replace(/^\s*\d{1,2}\.\d{1,2}\.\d{4}\s*/, '')
      .replace(/\s*FA\s*\d+\s*$/i, '')
      .trim();
    // Smakk n'a pas de nom_event → repli sur societe puis name.
    const clientName = clientFromEvent
      || stripHtml(String(row.societe || '')).trim()
      || stripHtml(String(row.name || '')).trim()
      || 'Client inconnu';

    events.push({
      id: `rdy_${brand}_${orderId}`,
      orderId,
      brand,
      date,
      clientName,
      eventName: null,
      produitNom,
      boxIds: stripHtml(String(row.box_id || '')).trim(),
    });
  }
  return events;
}

async function fetchShootnboxReadinessEvents(signal?: AbortSignal): Promise<ReadinessEvent[]> {
  if (!SHOOTNBOX_EMAIL || !SHOOTNBOX_PASSWORD) {
    console.warn('[Readiness] Shootnbox credentials manquants — readiness Shootnbox ignorée');
    return [];
  }
  const cookie = await crmLogin(SHOOTNBOX_BASE, SHOOTNBOX_EMAIL, SHOOTNBOX_PASSWORD, 'ShootNBox', signal);
  const response = await fetch(`${SHOOTNBOX_BASE}/readiness_ajax.php`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'draw=1&start=0&length=1000',
    signal,
  });
  const data = await response.json() as any;
  return parseReadinessRows(data.aaData || data.data || [], 'shootnbox');
}

async function fetchSmakkReadinessEvents(signal?: AbortSignal): Promise<ReadinessEvent[]> {
  const response = await fetch(`${SMAKK_MANAGER_BASE}/readiness_ajax.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'draw=1&start=0&length=1000',
    signal: signal ?? AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Smakk readiness HTTP ${response.status}`);
  const data = await response.json() as any;
  return parseReadinessRows(data.aaData || data.data || [], 'smakk');
}

let readinessCache: { events: ReadinessEvent[]; at: number } | null = null;
const READINESS_CACHE_TTL_MS = 60 * 1000;

/**
 * Événements de préparation fusionnés des deux CRM (Shootnbox + Smakk),
 * bornés entre aujourd'hui et +60 jours. Cache mémoire de 60 s pour éviter
 * un login Shootnbox à chaque ouverture de modal.
 */
export async function fetchReadinessEvents(): Promise<ReadinessEvent[]> {
  if (readinessCache && Date.now() - readinessCache.at < READINESS_CACHE_TTL_MS) {
    return readinessCache.events;
  }

  // Les deux CRM en parallèle ; une marque en échec ne bloque pas l'autre.
  const [snb, smk] = await Promise.allSettled([
    fetchShootnboxReadinessEvents(),
    fetchSmakkReadinessEvents(),
  ]);

  const all: ReadinessEvent[] = [];
  if (snb.status === 'fulfilled') all.push(...snb.value);
  else console.error('[Readiness] Shootnbox échec:', snb.reason);
  if (smk.status === 'fulfilled') all.push(...smk.value);
  else console.error('[Readiness] Smakk échec:', smk.reason);

  // Fenêtre temporelle : aujourd'hui → +60 j.
  const today = new Date();
  const startStr = today.toISOString().substring(0, 10);
  const endStr = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const filtered = all
    .filter(e => e.date >= startStr && e.date <= endStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  readinessCache = { events: filtered, at: Date.now() };
  return filtered;
}

// ─── Import Chronopost depuis le CRM ──────────────────────────────
// Les commandes en mode "Chronopost" sont exclues des pending_points (pas de
// chauffeur) → elles alimentent la section Chronopost dédiée. On les importe
// des DEUX managers comme des "événements" (sans n° de colis : il n'existe qu'à
// l'expédition). Upsert par externalId, sans écraser les saisies utilisateur ni
// le suivi colis (Chronotrace).

export interface ChronopostCrmSyncResult {
  created: number;
  updated: number;
  errors: string[];
}

// Type de borne pour la section Chronopost (pas de variante Slim dans sa liste).
function normalizeChronoProduit(raw: string): string | null {
  const base = normalizeBoxType(stripHtml(String(raw || '')).trim());
  const stripped = base.replace(/\s*slim$/i, '').trim();
  return stripped || null;
}

async function upsertChronopostFromCrm(
  rec: {
    externalId: string;
    source: 'crm_shootnbox' | 'crm_smakk';
    clientNom: string;
    produitNom: string | null;
    clientAdresse: string | null;
    clientVille: string | null;
    contactNom: string | null;
    contactTelephone: string | null;
    modeRetour: string | null;
    dateEvenement: string | null;   // ISO yyyy-mm-dd
    dateDepart: string | null;      // ISO
    dateRetourPrevu: string | null; // ISO
  },
  result: ChronopostCrmSyncResult,
): Promise<void> {
  const toDate = (s: string | null) => (s ? ensureDateUTC(s) : null);
  try {
    const existing = await prisma.chronopostExpedition.findUnique({ where: { externalId: rec.externalId } });
    if (!existing) {
      await prisma.chronopostExpedition.create({
        data: {
          externalId: rec.externalId,
          source: rec.source,
          clientNom: rec.clientNom,
          produitNom: rec.produitNom,
          clientAdresse: rec.clientAdresse,
          clientVille: rec.clientVille,
          contactNom: rec.contactNom,
          contactTelephone: rec.contactTelephone,
          modeRetour: rec.modeRetour,
          dateEvenement: toDate(rec.dateEvenement),
          dateDepart: toDate(rec.dateDepart),
          dateRetourPrevu: toDate(rec.dateRetourPrevu),
          statut: 'en_preparation',
        },
      });
      result.created++;
    } else {
      // Maj des infos CRM sans écraser le n° de colis, le statut manuel ni les
      // dates transporteur déjà connues (Chronotrace/manuel).
      await prisma.chronopostExpedition.update({
        where: { id: existing.id },
        data: {
          source: rec.source,
          clientNom: rec.clientNom,
          ...(rec.produitNom && { produitNom: rec.produitNom }),
          ...(rec.clientAdresse && { clientAdresse: rec.clientAdresse }),
          ...(rec.clientVille && { clientVille: rec.clientVille }),
          ...(rec.contactNom && { contactNom: rec.contactNom }),
          ...(rec.contactTelephone && { contactTelephone: rec.contactTelephone }),
          ...(rec.modeRetour && { modeRetour: rec.modeRetour }),
          ...(rec.dateEvenement && { dateEvenement: toDate(rec.dateEvenement) }),
          ...(rec.dateDepart && !existing.dateDepart && { dateDepart: toDate(rec.dateDepart) }),
          ...(rec.dateRetourPrevu && !existing.dateRetourPrevu && { dateRetourPrevu: toDate(rec.dateRetourPrevu) }),
        },
      });
      result.updated++;
    }
  } catch (e: any) {
    result.errors.push(`${rec.externalId}: ${e.message}`);
  }
}

export let lastChronopostCrmSyncResult: (ChronopostCrmSyncResult & { completedAt: string }) | null = null;

export async function syncChronopostFromCrm(): Promise<ChronopostCrmSyncResult> {
  const result: ChronopostCrmSyncResult = { created: 0, updated: 0, errors: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('syncChronopostFromCrm timeout (60s)')), 60_000);

  // ── Shootnbox : UNION de deux critères ──
  //   1. box_type = "Vegas Slim" (toujours envoyé par transporteur) — depuis orders_ajax status=2
  //   2. formulaire logistique marqué Chronopost (logType=chronopost) — n'importe quel type de borne
  if (SHOOTNBOX_EMAIL && SHOOTNBOX_PASSWORD) {
    try {
      const cookie = await crmLogin(SHOOTNBOX_BASE, SHOOTNBOX_EMAIL, SHOOTNBOX_PASSWORD, 'ShootNBox Chronopost', controller.signal);

      // Infos commandes par orderId (box_type, client, date événement)
      const ordersMap = new Map<string, { boxType: string; clientName: string; eventISO: string | null }>();
      try {
        for (const urlSuffix of ['orders_ajax.php?status=2', 'orders_ajax.php?status=2&arch=true']) {
          let start = 0;
          let total = 0;
          do {
            const { rows, totalFiltered } = await fetchOrdersPage(cookie, `${SHOOTNBOX_BASE}/${urlSuffix}`, start, 500, controller.signal);
            if (rows.length === 0) break;
            total = totalFiltered;
            for (const row of rows) {
              const oid = String(row.id || '').trim();
              if (!oid) continue;
              const [company, person] = parseCustomerField(String(row.customer || ''));
              ordersMap.set(oid, {
                boxType: stripHtml(String(row.box_type || '')),
                clientName: (company || person || '').trim(),
                eventISO: pendingDateDMY(stripHtml(String(row.event_date || ''))),
              });
            }
            start += 500;
          } while (start < total);
        }
      } catch (e: any) { result.errors.push(`Shootnbox orders: ${e.message}`); }

      // Formulaires logistiques (clé = order_id)
      const lookupKey = process.env.CRM_LOOKUP_KEY || 'otb_crm_lookup_2026';
      const formByOrderId = new Map<string, { d: any; logType: string; eventISO: string | null; clientNom: string }>();
      try {
        const resp = await fetch(`${SHOOTNBOX_BASE}/otb_cfg_bulk.php?key=${lookupKey}`, { signal: controller.signal });
        const body = await resp.json() as any[];
        for (const cfg of (Array.isArray(body) ? body : [])) {
          const oid = String(cfg.order_id || '').trim();
          if (!oid) continue;
          const clientNom = stripHtml(String(cfg.societe || '')).trim()
            || `${stripHtml(String(cfg.first_name || ''))} ${stripHtml(String(cfg.last_name || ''))}`.trim();
          formByOrderId.set(oid, {
            d: cfg.submitted_data || {},
            logType: cfg.logistique_type || '',
            eventISO: pendingDateDMY(stripHtml(String(cfg.event_date || ''))),
            clientNom,
          });
        }
      } catch (e: any) { result.errors.push(`Shootnbox forms: ${e.message}`); }

      // Ensemble éligible = Vegas Slim (orders) ∪ formulaires Chronopost
      const eligibleIds = new Set<string>();
      for (const [oid, o] of ordersMap) if (/slim/i.test(o.boxType)) eligibleIds.add(oid);
      for (const [oid, f] of formByOrderId) if (f.logType === 'chronopost') eligibleIds.add(oid);

      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      for (const orderId of eligibleIds) {
        const o = ordersMap.get(orderId);
        const f = formByOrderId.get(orderId);
        const isChronoForm = f?.logType === 'chronopost';
        const d = f?.d || {};

        const eventISO = f?.eventISO || o?.eventISO || null;
        if (eventISO && new Date(eventISO) < today) continue; // événements passés ignorés

        const clientNom = (f?.clientNom || '').trim() || o?.clientName || `Commande ${orderId}`;
        // Adresse/contact seulement si formulaire Chronopost rempli (champs log_chrono_*)
        const adresse = isChronoForm
          ? pendingBuildAddress(d.log_chrono_rue_num, d.log_chrono_rue_nom, d.log_chrono_cp, d.log_chrono_ville)
          : '';

        await upsertChronopostFromCrm({
          externalId: `snb_order_${orderId}`,
          source: 'crm_shootnbox',
          clientNom,
          produitNom: normalizeChronoProduit(o?.boxType || ''),
          clientAdresse: adresse || null,
          clientVille: isChronoForm ? (d.log_chrono_ville || '').trim() || null : null,
          contactNom: isChronoForm ? clientNom : null,
          contactTelephone: isChronoForm ? (d.log_chrono_tel || '').trim() || null : null,
          modeRetour: isChronoForm ? (d.log_chrono_retour || '').trim() || null : null,
          dateEvenement: eventISO,
          dateDepart: eventISO, // pas de date transporteur côté Shootnbox → position sur l'événement
          dateRetourPrevu: null,
        }, result);
      }
    } catch (e: any) {
      result.errors.push(`Shootnbox: ${e.message}`);
    }
  }

  // ── Smakk : _otb_orders.php, delivery_options contient "chronopost" ──
  try {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    let page = 0;
    let total = 0;
    do {
      const url = `${SMAKK_API_URL}?key=${SMAKK_API_KEY}&page=${page}&size=500`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Smakk API HTTP ${response.status}`);
      const data = await response.json() as any;
      if (data.error) throw new Error(`Smakk API error: ${data.error}`);
      total = data.total || 0;
      const rows: any[] = data.data || [];

      for (const row of rows) {
        const delivOpts = String(row.delivery_options || '').toLowerCase();
        const isSlim = String(row.box_type || '').toLowerCase().includes('slim');
        // Inclus si : livraison Chronopost choisie OU borne Slim (toujours par transporteur)
        if (!delivOpts.includes('chronopost') && !isSlim) continue;
        const orderId = String(row.id || '').trim();
        if (!orderId) continue;
        const eventISO = pendingDateDMY(String(row.event_date || '').trim());
        if (eventISO && new Date(eventISO) < today) continue;

        const clientNom = String(row.company || '').trim()
          || [row.first_name, row.last_name].filter(Boolean).map((s: string) => s.trim()).join(' ').trim()
          || `Commande ${orderId}`;
        const adresse = pendingBuildAddress(undefined, (row.address || '').trim(), (row.cp || '').trim(), (row.city || '').trim());

        await upsertChronopostFromCrm({
          externalId: `smk_order_${orderId}`,
          source: 'crm_smakk',
          clientNom,
          produitNom: normalizeChronoProduit(String(row.box_type || '')),
          clientAdresse: adresse || null,
          clientVille: (row.city || '').trim() || null,
          contactNom: (row.take_contact || '').trim() || null,
          contactTelephone: (row.phone || '').trim() || null,
          modeRetour: null,
          dateEvenement: eventISO,
          dateDepart: pendingDateDMY(String(row.take_date || '').trim()) || eventISO,
          dateRetourPrevu: pendingDateDMY(String(row.return_date || '').trim()),
        }, result);
      }

      page++;
      if (rows.length === 0) break;
    } while (page * 500 < total);
  } catch (e: any) {
    result.errors.push(`Smakk: ${e.message}`);
  }

  clearTimeout(timeout);
  lastChronopostCrmSyncResult = { ...result, completedAt: new Date().toISOString() };
  console.log(`[Chronopost CRM] Terminé: created=${result.created}, updated=${result.updated}, errors=${result.errors.length}`);
  return result;
}

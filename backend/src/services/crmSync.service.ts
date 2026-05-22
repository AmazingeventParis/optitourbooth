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
// Returns Map<orderId, { eventName, deliveryType }> from _otb_readiness.php
// deliveryType = colonne "Livraison" de readiness.php (ex: "Livraison", "Retrait boutique", "Chronopost")

async function fetchSmakkReadiness(signal?: AbortSignal): Promise<Map<string, { eventName: string; deliveryType: string }>> {
  const map = new Map<string, { eventName: string; deliveryType: string }>();
  try {
    const url = `https://www.smakk.fr/manager/_otb_readiness.php?key=${SMAKK_API_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return map;
    const data = await response.json() as any;
    for (const row of (data.data || data || [])) {
      const id = String(row.id || '').trim();
      if (!id) continue;
      const name = (row.nom_event || row.event_name || row.eventName || '').trim();
      // Colonne "Livraison" : essayer plusieurs noms de champ possibles
      const deliveryType = (
        row.livraison || row.delivery || row.delivery_type ||
        row.type_livraison || row.type_delivery || ''
      ).trim();
      map.set(id, { eventName: name, deliveryType });
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

// Parse Smakk créneau string "9h30 - 14h" or "14h00" → [debut, fin]
function parseSmakkCreneau(raw: string): [string | null, string | null] {
  if (!raw) return [null, null];
  const parts = raw.split(/\s*[-–]\s*/);
  const debut = parts[0]?.trim() || null;
  const fin = parts[1]?.trim() || null;
  return [debut, fin];
}

// ─── Smakk Info Client (mail-infos-smk.php) ──────────────────────
// Données remplies par le client quand il répond au mail info logistique.
// Source de vérité prioritaire sur _otb_orders.php pour les dates et l'adresse.

interface SmakkInfoClient {
  adresse: string | null;
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
    adresse: null, livDateISO: null, livCreneauDebut: null, livCreneauFin: null,
    recDateISO: null, recCreneauDebut: null, recCreneauFin: null,
    contactNom: null, contactTelephone: null,
  };
  if (!html) return result;

  const rows = [...html.matchAll(/<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>/gis)];
  for (const [, rawLabel, rawValue] of rows) {
    const label = (rawLabel || '').replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '').trim().toLowerCase();
    const value = (rawValue || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&[^;]+;/g, '').trim();
    if (!label || !value) continue;

    if (label.includes('adresse')) {
      result.adresse = value;
    } else if (label.includes('jour') && label.includes('livraison')) {
      result.livDateISO = parseDateDDMMYYYY(value);
    } else if (label.includes('livraison') && (label.includes('cr') && label.includes('neau'))) {
      [result.livCreneauDebut, result.livCreneauFin] = parseSmakkCreneau(value);
    } else if (label.includes('jour') && (label.includes('cup') || label.includes('cup'))) {
      result.recDateISO = parseDateDDMMYYYY(value);
    } else if ((label.includes('cup') || label.includes('cup')) && (label.includes('cr') && label.includes('neau'))) {
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
  errors: string[];
  completedAt?: string;
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
        if (rows.length === 0) break;
        total = totalFiltered;

        for (const row of rows) {
          const deliveryVal = stripHtml(String(row.delivery || '')).toLowerCase();
          // Exclure Retrait boutique et Chronopost (pas de chauffeur)
          if (!deliveryVal.includes('livraison') && !deliveryVal.includes('installation')) continue;
          if (deliveryVal.includes('retrait') || deliveryVal.includes('chronopost')) continue;
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
              manuallyEdited: !!form,
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
              dispatched: false,
              ...(!existingLiv.manuallyEdited && form && parsedLiv && {
                ...(parsedLiv.adresse && { adresse: parsedLiv.adresse }),
                ...(parsedLiv.creneauDebut && { creneauDebut: parsedLiv.creneauDebut }),
                ...(parsedLiv.creneauFin && { creneauFin: parsedLiv.creneauFin }),
                ...(parsedLiv.contactNom && { contactNom: parsedLiv.contactNom }),
                ...(parsedLiv.contactTelephone && { contactTelephone: parsedLiv.contactTelephone }),
                ...(parsedLiv.notes && { notes: parsedLiv.notes }),
                manuallyEdited: true,
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
                adresse: parsedRec?.adresse || null,
                creneauDebut: parsedRec?.creneauDebut || null,
                creneauFin: parsedRec?.creneauFin || null,
                contactNom: parsedRec?.contactNom || null,
                contactTelephone: parsedRec?.contactTelephone || null,
                notes: parsedRec?.notes || null,
                quantiteBornes,
                manuallyEdited: !!form,
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
              dispatched: false,
              ...(!existingRec.manuallyEdited && form && parsedRec && {
                ...(parsedRec.adresse && { adresse: parsedRec.adresse }),
                ...(parsedRec.creneauDebut && { creneauDebut: parsedRec.creneauDebut }),
                ...(parsedRec.creneauFin && { creneauFin: parsedRec.creneauFin }),
                ...(parsedRec.contactNom && { contactNom: parsedRec.contactNom }),
                ...(parsedRec.contactTelephone && { contactTelephone: parsedRec.contactTelephone }),
                ...(parsedRec.notes && { notes: parsedRec.notes }),
                manuallyEdited: true,
              }),
            },
          });
          if (form && parsedRec) result.enriched++;
        }
      } catch (e: any) {
        result.errors.push(`Ramassage ${order.orderId}: ${e.message}`);
      }
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
        // Filtre positif : uniquement les livraisons/installations explicites
        // Vide, Retrait boutique, Chronopost → skip
        const delivOpts = (row.delivery_options || '').toLowerCase();
        if (!delivOpts.includes('livraison') && !delivOpts.includes('installation')) {
          result.skipped++;
          continue;
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
      const livDateISO = ic?.livDateISO || order.livDateISO;
      const recDateISO = ic?.recDateISO || order.recDateISO;
      const adresse = ic?.adresse || order.adresse;
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
          }});
          result.created++;
          console.log(`[CRM PendingPoints Smakk] + ${order.clientName}${smkEventName ? ` (${smkEventName})` : ''} livraison ${livDateISO}${ic ? ' (info client)' : ''}`);
        } else if (!existingLiv.manuallyEdited) {
          await prisma.pendingPoint.update({ where: { id: existingLiv.id }, data: {
            date: ensureDateUTC(livDateISO),
            clientName: order.clientName,
            ...(smkEventName && { eventName: smkEventName }),
            adresse,
            creneauDebut: creneauDebutLiv,
            creneauFin: creneauFinLiv,
            contactNom,
            contactTelephone,
          }});
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
            adresse,
            creneauDebut: creneauDebutRec,
            creneauFin: creneauFinRec,
            contactNom: contactNomRec,
            contactTelephone,
          }});
          result.created++;
          console.log(`[CRM PendingPoints Smakk] + ${order.clientName}${smkEventName ? ` (${smkEventName})` : ''} ramassage ${recDateISO}${ic ? ' (info client)' : ''}`);
        } else if (!existingRec.manuallyEdited) {
          await prisma.pendingPoint.update({ where: { id: existingRec.id }, data: {
            date: ensureDateUTC(recDateISO),
            clientName: order.clientName,
            ...(smkEventName && { eventName: smkEventName }),
            adresse,
            creneauDebut: creneauDebutRec,
            creneauFin: creneauFinRec,
            contactNom: contactNomRec,
            contactTelephone,
          }});
        }
      } catch (e: any) { result.errors.push(`Smakk ramassage ${order.orderId}: ${e.message}`); }
    }

  } catch (e: any) {
    result.errors.push(e.message || 'Erreur inattendue');
  }

  // ── Post-processing A : CRM prime sur GCal (Option B) ──
  // Si un point CRM (non-dispatché) existe pour (date, type, clientName) → soft-delete les points
  // google_calendar correspondants non-dispatchés (doublons multi-bornes, ex: 4 events GCal → 1 point CRM ×4)
  // On marque deletedByUser=true pour que Post-processing B (qui filtre sur deletedByUser=false)
  // ne les utilise jamais comme prétexte pour dispatcher les points CRM en retour.
  try {
    const ppToday2 = new Date(); ppToday2.setUTCHours(0, 0, 0, 0);
    const horizon2 = new Date(ppToday2); horizon2.setDate(horizon2.getDate() + 60);

    const crmActive = await prisma.pendingPoint.findMany({
      where: {
        source: { in: ['crm_shootnbox', 'crm_smakk'] },
        dispatched: false,
        date: { gte: ppToday2, lte: horizon2 },
      },
      select: { date: true, clientName: true, type: true },
    });

    if (crmActive.length > 0) {
      const gcalPending = await prisma.pendingPoint.findMany({
        where: {
          source: 'google_calendar',
          dispatched: false,
          deletedByUser: false,
          date: { gte: ppToday2, lte: horizon2 },
        },
        select: { id: true, date: true, clientName: true, type: true, externalId: true },
      });

      const toSupersede: string[] = [];
      for (const gc of gcalPending) {
        const gcDate = gc.date.toISOString().substring(0, 10);
        const gcNorm = normalizeForMatch(gc.clientName);
        const hasCrmMatch = crmActive.some((c: { date: Date; clientName: string; type: string }) => {
          if (c.date.toISOString().substring(0, 10) !== gcDate) return false;
          if (c.type !== gc.type) return false;
          const cNorm = normalizeForMatch(c.clientName);
          return gcNorm && cNorm && (gcNorm.includes(cNorm) || cNorm.includes(gcNorm));
        });
        if (hasCrmMatch) toSupersede.push(gc.id);
      }

      if (toSupersede.length > 0) {
        await prisma.pendingPoint.updateMany({
          where: { id: { in: toSupersede } },
          data: { dispatched: true, deletedByUser: true },
        });
        result.autoDispatched += toSupersede.length;
        console.log(`[CRM PendingPoints] ✓ ${toSupersede.length} point(s) GCal supprimés (remplacés par point CRM multi-bornes)`);
      }
    }
  } catch (e: any) {
    console.warn('[CRM PendingPoints] Post-processing CRM→GCal dedup failed:', e.message);
  }

  // ── Post-processing B : détecter les vrais doublons CRM ↔ Google Calendar ──
  // Condition : un point google_calendar réellement en tournée (dispatched=true, deletedByUser=false)
  // existe pour la même (date exacte, type, client similaire).
  // deletedByUser=false exclut les points soft-deletés par Post-processing A.
  try {
    const ppToday = new Date(); ppToday.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(ppToday); horizon.setDate(horizon.getDate() + 60);

    const crmNonDispatched = await prisma.pendingPoint.findMany({
      where: {
        source: { in: ['crm_shootnbox', 'crm_smakk'] },
        dispatched: false,
        date: { gte: ppToday, lte: horizon },
      },
      select: { id: true, date: true, clientName: true, type: true },
    });

    if (crmNonDispatched.length > 0) {
      // Charger uniquement les points GCal réellement en tournée (dispatched=true, deletedByUser=false)
      const gcalDispatched = await prisma.pendingPoint.findMany({
        where: {
          source: 'google_calendar',
          dispatched: true,
          deletedByUser: false,
          date: { gte: ppToday, lte: horizon },
        },
        select: { date: true, clientName: true, type: true, externalId: true },
      });

      for (const pp of crmNonDispatched) {
        const dateStr = pp.date.toISOString().substring(0, 10);
        const clientNorm = normalizeForMatch(pp.clientName);
        const dup = gcalDispatched.find((g: { date: Date; clientName: string; type: string; externalId: string | null }) => {
          if (g.date.toISOString().substring(0, 10) !== dateStr) return false;
          if (g.type !== pp.type) return false;
          const gNorm = normalizeForMatch(g.clientName);
          return clientNorm && gNorm && (gNorm.includes(clientNorm) || clientNorm.includes(gNorm));
        });
        if (dup) {
          await prisma.pendingPoint.update({ where: { id: pp.id }, data: { dispatched: true } });
          result.autoDispatched++;
          console.log(`[CRM PendingPoints] ✓ ${pp.clientName} ${pp.type} ${dateStr} → dispatché auto (doublon GCal: ${dup.externalId})`);
        }
      }
      if (result.autoDispatched > 0) console.log(`[CRM PendingPoints] ${result.autoDispatched} doublon(s) GCal auto-dispatché(s)`);
    }
  } catch (e: any) {
    console.warn('[CRM PendingPoints] Post-processing dispatched check failed:', e.message);
  }

  clearTimeout(masterTimeout);
  result.completedAt = new Date().toISOString();
  lastPendingPointsSyncResult = result;
  console.log(`[CRM PendingPoints] Terminé: created=${result.created}, enriched=${result.enriched}, skipped=${result.skipped}, autoDispatched=${result.autoDispatched}, errors=${result.errors.length}`);

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

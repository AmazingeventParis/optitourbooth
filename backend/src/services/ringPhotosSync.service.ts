/**
 * CRM Photos Sync Service
 * Downloads photos from Shootnbox CRM albums and uploads them to Google Drive.
 *
 * For ALL borne types (Vegas, Ring, etc.):
 *  - Ring: creates Drive folder + uploads photos (no existing folder)
 *  - Vegas: finds EXISTING Drive folder + adds photos (photobooth software
 *    already created the folder with test photos)
 *
 * Sources:
 *  - albums_list.php: orderId → numFacture, identifiant, customerName, date, borne
 *  - readiness_ajax.php: orderId → société (for matching Drive folder names)
 *
 * Matching Drive folders:
 *  Drive folders are named "DD.MM.YYYY Client Name" (created by photobooth).
 *  We match by date + fuzzy name (société or contactName).
 *
 * Runs every hour via setInterval (configured in app.ts).
 */

import { Readable } from 'stream';
import { google } from 'googleapis';
import { config } from '../config/index.js';
import { isDriveConfigured } from './googleDrive.service.js';

// ─── Types ───────────────────────────────────────────────────────

interface CrmAlbumRecord {
  orderId: string;
  customerName: string;
  societe: string;       // from readiness (company name)
  eventDate: string;     // DD.MM.YYYY
  numFacture: string;    // FAxxxxx (= login)
  identifiant: string;   // 6-digit code (= password)
  borne: string;
}

interface PhotoSyncResult {
  albumsFound: number;
  foldersCreated: number;
  foldersMatched: number;
  photosUploaded: number;
  albumsSkipped: number;
  errors: string[];
}

// ─── Config ──────────────────────────────────────────────────────

const CRM_BASE_URL = 'https://www.shootnbox.fr/manager2';
const UPLOADS_BASE_URL = 'https://shootnbox.fr/uploads';
const CRM_EMAIL = process.env.CRM_SHOOTNBOX_EMAIL || '';
const CRM_PASSWORD = process.env.CRM_SHOOTNBOX_PASSWORD || '';

const SYNC_PAST_DAYS = 14;

// ─── Drive client (OAuth — needed for upload quota) ──────────────

/**
 * Get Drive client using OAuth2 (user credentials) instead of service account.
 * Service accounts have no storage quota and can't upload to personal Drive.
 */
function getOAuthDriveClient() {
  const clientId = config.googleCalendar.oauthClientId;
  const clientSecret = config.googleCalendar.oauthClientSecret;
  const refreshToken = config.googleCalendar.oauthRefreshToken;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth credentials not configured (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN)');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

// ─── Helpers ─────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
}

function parseCrmDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const year = parseInt(match[3]!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function normalizeForMatch(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  if (na.length >= 5 && nb.length >= 5) {
    if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true;
  }
  return false;
}

// ─── CRM Auth ────────────────────────────────────────────────────

async function crmLogin(): Promise<string> {
  if (!CRM_EMAIL || !CRM_PASSWORD) {
    throw new Error('CRM credentials not configured');
  }

  const response = await fetch(`${CRM_BASE_URL}/d26386b04e.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `event=login&email=${encodeURIComponent(CRM_EMAIL)}&password=${encodeURIComponent(CRM_PASSWORD)}`,
    redirect: 'manual',
  });

  const text = await response.text();
  if (text.trim() !== 'done') throw new Error(`CRM login failed: ${text.trim()}`);

  const setCookies = response.headers.getSetCookie?.() || [];
  const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
  if (!cookieHeader) throw new Error('No session cookie');

  return cookieHeader;
}

// ─── Scrape CRM data ─────────────────────────────────────────────

/**
 * Scrape readiness → orderId → société map
 */
async function scrapeReadinessSocietes(cookie: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const response = await fetch(`${CRM_BASE_URL}/readiness_ajax.php`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'draw=1&start=0&length=500',
  });

  const data = await response.json() as any;
  const rows = data.aaData || data.data || [];

  for (const row of rows) {
    const orderId = String(stripHtml(String(row.id || ''))).trim();
    const societe = stripHtml(String(row.societe || ''));
    if (orderId && societe) {
      map.set(orderId, societe);
    }
  }

  return map;
}

/**
 * Scrape albums_list.php → all albums with date/borne filter, enriched with société
 */
async function scrapeAlbums(cookie: string, societeMap: Map<string, string>): Promise<CrmAlbumRecord[]> {
  const response = await fetch(`${CRM_BASE_URL}/albums_list.php`, {
    headers: { Cookie: cookie },
  });

  const html = await response.text();
  if (html.includes('<title>Entrance</title>')) throw new Error('CRM session expired');

  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];

  const rows = tbodyMatch[1]!.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
  const albums: CrmAlbumRecord[] = [];
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - SYNC_PAST_DAYS * 24 * 60 * 60 * 1000);

  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (cells.length < 8) continue;

    const eventDate = stripHtml(cells[5]!);
    const date = parseCrmDate(eventDate);
    if (!date || date < cutoffDate) continue;

    const orderId = stripHtml(cells[0]!);
    const nameMatch = cells[1]!.match(/<b>([^<]+)<\/b>/);
    const customerName = nameMatch ? nameMatch[1]!.trim() : '';
    const borne = stripHtml(cells[2]!);

    const linkMatch = cells[7]!.match(/login=([^&"]+).*?password=([^&"]+)/);
    const numFacture = linkMatch ? linkMatch[1]! : stripHtml(cells[3]!);
    const identifiant = linkMatch ? linkMatch[2]! : stripHtml(cells[4]!);

    const societe = societeMap.get(orderId) || '';

    albums.push({
      orderId,
      customerName,
      societe,
      eventDate,
      numFacture,
      identifiant,
      borne,
    });
  }

  return albums;
}

// ─── Album photos ────────────────────────────────────────────────

/**
 * Get the list of photo files from an album page.
 */
async function getAlbumFiles(cookie: string, numFacture: string, identifiant: string): Promise<string[]> {
  const response = await fetch(
    `${CRM_BASE_URL}/../album/?login=${numFacture}&password=${identifiant}`,
    { headers: { Cookie: cookie } }
  );

  const html = await response.text();
  const match = html.match(/var\s+files\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return [];

  return Array.from(match[1]!.matchAll(/'([^']+)'/g), m => m[1]!);
}

// ─── Drive operations ────────────────────────────────────────────

interface DriveFolder {
  id: string;
  name: string;
}

/**
 * List all folders in the parent Drive folder.
 */
async function listDriveFolders(): Promise<DriveFolder[]> {
  const drive = getOAuthDriveClient();
  const parentId = config.googleDrive.parentFolderId;
  const folders: DriveFolder[] = [];

  let pageToken: string | undefined;
  do {
    const response = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 1000,
      supportsAllDrives: true,
      ...(pageToken && { pageToken }),
    });

    for (const file of response.data.files || []) {
      if (file.id && file.name) {
        folders.push({ id: file.id, name: file.name });
      }
    }
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return folders;
}

/**
 * Find a Drive folder matching a CRM album by date + name.
 * Drive folder names: "DD.MM.YYYY Client Name" or "DD.MM.YY Client Name"
 */
function findMatchingDriveFolder(album: CrmAlbumRecord, driveFolders: DriveFolder[]): DriveFolder | null {
  for (const folder of driveFolders) {
    // Parse folder name: "DD.MM.YYYY Name" or "DD.MM.YY Name"
    const folderMatch = folder.name.match(/^(\d{2})\.(\d{2})\.(\d{2,4})\s+(.+)$/);
    if (!folderMatch) continue;

    // Check date match
    const fDay = folderMatch[1]!;
    const fMonth = folderMatch[2]!;
    let fYear = folderMatch[3]!;
    if (fYear.length === 2) fYear = '20' + fYear;
    const folderDate = `${fDay}.${fMonth}.${fYear}`;

    if (folderDate !== album.eventDate) continue;

    // Check name match — try société first, then customerName
    const folderClientName = folderMatch[4]!.trim();

    if (album.societe && namesMatch(folderClientName, album.societe)) return folder;
    if (album.customerName && namesMatch(folderClientName, album.customerName)) return folder;
  }

  return null;
}

/**
 * Get existing file names in a Drive folder.
 */
async function listDriveFileNames(folderId: string): Promise<Set<string>> {
  const drive = getOAuthDriveClient();
  const names = new Set<string>();

  let pageToken: string | undefined;
  do {
    const resp = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(name)',
      pageSize: 1000,
      supportsAllDrives: true,
      ...(pageToken && { pageToken }),
    });
    for (const f of resp.data.files || []) {
      if (f.name) names.add(f.name);
    }
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);

  return names;
}

/**
 * Create a folder in Drive.
 */
async function createDriveFolder(folderName: string): Promise<string> {
  const drive = getOAuthDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [config.googleDrive.parentFolderId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  return response.data.id!;
}

/**
 * Upload a file to Drive by streaming from a URL.
 */
async function uploadFileToDrive(folderId: string, fileName: string, fileUrl: string): Promise<void> {
  const drive = getOAuthDriveClient();

  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const body = response.body;
  if (!body) throw new Error('Empty response body');

  const nodeStream = Readable.fromWeb(body as any);

  await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: contentType,
      body: nodeStream,
    },
    fields: 'id',
    supportsAllDrives: true,
  });
}

// ─── Main sync ───────────────────────────────────────────────────

export async function syncCrmPhotos(): Promise<PhotoSyncResult> {
  const result: PhotoSyncResult = {
    albumsFound: 0,
    foldersCreated: 0,
    foldersMatched: 0,
    photosUploaded: 0,
    albumsSkipped: 0,
    errors: [],
  };

  if (!isDriveConfigured()) {
    result.errors.push('Google Drive not configured');
    return result;
  }

  // 1. Login
  let cookie: string;
  try {
    cookie = await crmLogin();
  } catch (e: any) {
    result.errors.push(`CRM login failed: ${e.message}`);
    return result;
  }

  // 2. Scrape readiness (société map) + albums in parallel
  let albums: CrmAlbumRecord[];
  try {
    const societeMap = await scrapeReadinessSocietes(cookie);
    albums = await scrapeAlbums(cookie, societeMap);
    result.albumsFound = albums.length;
  } catch (e: any) {
    result.errors.push(`Scrape failed: ${e.message}`);
    return result;
  }

  if (albums.length === 0) return result;

  // 3. List existing Drive folders once
  let driveFolders: DriveFolder[];
  try {
    driveFolders = await listDriveFolders();
  } catch (e: any) {
    result.errors.push(`Drive list failed: ${e.message}`);
    return result;
  }

  // 4. Process each album
  for (const album of albums) {
    try {
      // Get photo files
      const allFiles = await getAlbumFiles(cookie, album.numFacture, album.identifiant);
      // Only images (skip .mov — too large for Drive upload via API)
      const imageFiles = allFiles.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
      if (imageFiles.length === 0) {
        result.albumsSkipped++;
        continue;
      }

      // Find or create Drive folder
      let folderId: string;
      const matchedFolder = findMatchingDriveFolder(album, driveFolders);

      if (matchedFolder) {
        folderId = matchedFolder.id;
        result.foldersMatched++;
      } else {
        // No existing folder — create one (Ring, or Vegas without photobooth folder)
        const folderName = `${album.eventDate} ${album.customerName || album.societe || album.numFacture}`;
        folderId = await createDriveFolder(folderName);
        result.foldersCreated++;
        // Add to list so next album with same folder won't recreate
        driveFolders.push({ id: folderId, name: folderName });
        console.log(`[Photos Sync] 📁 Created: ${folderName}`);
      }

      // Get existing files in Drive folder to skip duplicates
      const existingFiles = await listDriveFileNames(folderId);

      // Upload missing photos
      let uploadedCount = 0;
      for (const fileName of imageFiles) {
        if (existingFiles.has(fileName)) continue;

        try {
          const fileUrl = `${UPLOADS_BASE_URL}/${album.numFacture}/${fileName}`;
          await uploadFileToDrive(folderId, fileName, fileUrl);
          uploadedCount++;
          result.photosUploaded++;
        } catch (e: any) {
          result.errors.push(`Upload ${album.numFacture}/${fileName}: ${e.message}`);
        }
      }

      if (uploadedCount > 0) {
        const label = matchedFolder ? `→ ${matchedFolder.name}` : `(new folder)`;
        console.log(`[Photos Sync] 📷 ${album.borne} ${album.eventDate} ${album.customerName || album.societe}: +${uploadedCount} photos ${label}`);
      } else {
        result.albumsSkipped++;
      }
    } catch (e: any) {
      result.errors.push(`Album ${album.numFacture}: ${e.message}`);
    }
  }

  return result;
}

// ─── Cron control ────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startRingPhotosSync(): void {
  if (!CRM_EMAIL || !CRM_PASSWORD) {
    console.log('[Photos Sync] CRM credentials not configured, sync disabled');
    return;
  }

  if (!isDriveConfigured()) {
    console.log('[Photos Sync] Google Drive not configured, sync disabled');
    return;
  }

  const intervalMs = 60 * 60 * 1000; // 1 hour

  // Initial sync after 60 seconds
  setTimeout(async () => {
    try {
      const result = await syncCrmPhotos();
      console.log(
        `[Photos Sync] Initial: found=${result.albumsFound}, matched=${result.foldersMatched}, ` +
        `created=${result.foldersCreated}, uploaded=${result.photosUploaded}, skipped=${result.albumsSkipped}`
      );
      if (result.errors.length > 0) {
        console.warn('[Photos Sync] Errors:', result.errors.slice(0, 5));
      }
    } catch (e) {
      console.error('[Photos Sync] Initial sync error:', e);
    }
  }, 60_000);

  // Periodic sync every hour
  syncInterval = setInterval(async () => {
    try {
      const result = await syncCrmPhotos();
      console.log(
        `[Photos Sync] Sync: found=${result.albumsFound}, matched=${result.foldersMatched}, ` +
        `created=${result.foldersCreated}, uploaded=${result.photosUploaded}, skipped=${result.albumsSkipped}`
      );
      if (result.errors.length > 0) {
        console.warn('[Photos Sync] Errors:', result.errors.slice(0, 5));
      }
    } catch (e) {
      console.error('[Photos Sync] Sync error:', e);
    }
  }, intervalMs);

  console.log('⏰ CRON: CRM photos sync (all bornes) every 60 min');
}

export function stopRingPhotosSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Photos Sync] Sync stopped');
  }
}

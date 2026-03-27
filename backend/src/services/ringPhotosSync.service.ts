/**
 * Ring Photos Sync Service
 * Downloads photos from Shootnbox CRM Ring albums and uploads them to Google Drive.
 *
 * Ring bornes store photos on the CRM server (shootnbox.fr/uploads/FAxxxxx/).
 * Vegas bornes create folders locally that get synced to Drive by the photobooth software.
 * This service bridges the gap for Ring by pulling photos from CRM → pushing to Drive.
 *
 * Flow:
 *  1. Scrape albums_list.php for Ring albums (upcoming/recent)
 *  2. For each Ring album, check if Drive folder already exists
 *  3. If not, create folder in Drive as "DD.MM.YYYY Nom client"
 *  4. Parse album page to get file list
 *  5. Download each photo from shootnbox.fr/uploads/FAxxxxx/
 *  6. Upload to Drive folder (skip files already uploaded)
 *
 * Runs every hour via setInterval (configured in app.ts).
 */

import { Readable } from 'stream';
import { config } from '../config/index.js';
import { getDriveClient, isDriveConfigured } from './googleDrive.service.js';

// ─── Types ───────────────────────────────────────────────────────

interface RingAlbum {
  orderId: string;
  customerName: string;
  eventDate: string; // DD.MM.YYYY
  numFacture: string; // FAxxxxx
  identifiant: string; // 6-digit code
  borne: string;
}

interface RingSyncResult {
  albumsFound: number;
  foldersCreated: number;
  photosUploaded: number;
  albumsSkipped: number;
  errors: string[];
}

// ─── Config ──────────────────────────────────────────────────────

const CRM_BASE_URL = 'https://www.shootnbox.fr/manager2';
const UPLOADS_BASE_URL = 'https://shootnbox.fr/uploads';
const CRM_EMAIL = process.env.CRM_SHOOTNBOX_EMAIL || '';
const CRM_PASSWORD = process.env.CRM_SHOOTNBOX_PASSWORD || '';

// Only sync albums from the last N days and into the future
const SYNC_PAST_DAYS = 14;

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

// ─── Scrape Ring albums ──────────────────────────────────────────

/**
 * Scrape albums_list.php and extract Ring albums with recent/upcoming dates.
 */
async function scrapeRingAlbums(cookie: string): Promise<RingAlbum[]> {
  const response = await fetch(`${CRM_BASE_URL}/albums_list.php`, {
    headers: { Cookie: cookie },
  });

  const html = await response.text();

  if (html.includes('<title>Entrance</title>')) {
    throw new Error('CRM session expired');
  }

  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];

  const rows = tbodyMatch[1]!.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
  const albums: RingAlbum[] = [];
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - SYNC_PAST_DAYS * 24 * 60 * 60 * 1000);

  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (cells.length < 8) continue;

    const borne = stripHtml(cells[2]!);
    if (borne !== 'Ring') continue;

    const eventDate = stripHtml(cells[5]!);
    const date = parseCrmDate(eventDate);
    if (!date || date < cutoffDate) continue;

    const orderId = stripHtml(cells[0]!);
    const nameMatch = cells[1]!.match(/<b>([^<]+)<\/b>/);
    const customerName = nameMatch ? nameMatch[1]!.trim() : '';

    // Extract numFacture and identifiant from connexion link
    const linkMatch = cells[7]!.match(/login=([^&"]+).*?password=([^&"]+)/);
    const numFacture = linkMatch ? linkMatch[1]! : stripHtml(cells[3]!);
    const identifiant = linkMatch ? linkMatch[2]! : stripHtml(cells[4]!);

    albums.push({
      orderId,
      customerName,
      eventDate,
      numFacture,
      identifiant,
      borne,
    });
  }

  return albums;
}

// ─── Get photo file list from album page ─────────────────────────

/**
 * Access the album page and extract the files array from the JS.
 */
async function getAlbumFiles(cookie: string, numFacture: string, identifiant: string): Promise<string[]> {
  const response = await fetch(
    `${CRM_BASE_URL}/../album/?login=${numFacture}&password=${identifiant}`,
    { headers: { Cookie: cookie } }
  );

  const html = await response.text();

  // Extract files array: var files = ['file1.jpg', 'file2.gif', ...]
  const match = html.match(/var\s+files\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return [];

  return Array.from(match[1]!.matchAll(/'([^']+)'/g), m => m[1]!);
}

// ─── Google Drive operations ─────────────────────────────────────

/**
 * List existing folders in the parent Drive folder.
 * Returns a Set of folder names for quick lookup.
 */
async function listExistingDriveFolders(): Promise<Map<string, { id: string; fileCount: number }>> {
  const drive = getDriveClient();
  const parentId = config.googleDrive.parentFolderId;
  const folders = new Map<string, { id: string; fileCount: number }>();

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
        folders.set(file.name, { id: file.id, fileCount: -1 }); // fileCount loaded lazily
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return folders;
}

/**
 * Count files in a Drive folder.
 */
async function countDriveFiles(folderId: string): Promise<number> {
  const drive = getDriveClient();
  let count = 0;
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id)',
      pageSize: 1000,
      supportsAllDrives: true,
      ...(pageToken && { pageToken }),
    });

    count += (response.data.files || []).length;
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return count;
}

/**
 * Create a folder in Drive and return its ID.
 */
async function createDriveFolder(folderName: string): Promise<string> {
  const drive = getDriveClient();
  const parentId = config.googleDrive.parentFolderId;

  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  return response.data.id!;
}

/**
 * Upload a file to a Drive folder by streaming from a URL.
 */
async function uploadFileToDrive(folderId: string, fileName: string, fileUrl: string): Promise<void> {
  const drive = getDriveClient();

  // Download file as stream
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} for ${fileUrl}`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const body = response.body;
  if (!body) throw new Error(`Empty response body for ${fileUrl}`);

  // Convert Web ReadableStream to Node Readable
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

/**
 * Main sync: find Ring albums, create Drive folders, upload photos.
 */
export async function syncRingPhotos(): Promise<RingSyncResult> {
  const result: RingSyncResult = {
    albumsFound: 0,
    foldersCreated: 0,
    photosUploaded: 0,
    albumsSkipped: 0,
    errors: [],
  };

  if (!isDriveConfigured()) {
    result.errors.push('Google Drive not configured');
    return result;
  }

  // 1. Login to CRM
  let cookie: string;
  try {
    cookie = await crmLogin();
  } catch (e: any) {
    result.errors.push(`CRM login failed: ${e.message}`);
    return result;
  }

  // 2. Scrape Ring albums
  let ringAlbums: RingAlbum[];
  try {
    ringAlbums = await scrapeRingAlbums(cookie);
    result.albumsFound = ringAlbums.length;
  } catch (e: any) {
    result.errors.push(`Scrape failed: ${e.message}`);
    return result;
  }

  if (ringAlbums.length === 0) {
    return result;
  }

  // 3. List existing Drive folders
  let existingFolders: Map<string, { id: string; fileCount: number }>;
  try {
    existingFolders = await listExistingDriveFolders();
  } catch (e: any) {
    result.errors.push(`Drive folder list failed: ${e.message}`);
    return result;
  }

  // 4. Process each Ring album
  for (const album of ringAlbums) {
    const folderName = `${album.eventDate} ${album.customerName}`;

    try {
      // Get photo files from the album page
      const files = await getAlbumFiles(cookie, album.numFacture, album.identifiant);
      if (files.length === 0) {
        result.albumsSkipped++;
        continue;
      }

      // Only sync images (jpg, jpeg, png, gif) — skip .mov videos (too large)
      const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
      if (imageFiles.length === 0) {
        result.albumsSkipped++;
        continue;
      }

      // Check if folder already exists
      const existing = existingFolders.get(folderName);
      let folderId: string;

      if (existing) {
        // Folder exists — check if it already has all photos
        const driveFileCount = await countDriveFiles(existing.id);
        if (driveFileCount >= imageFiles.length) {
          result.albumsSkipped++;
          continue; // Already fully synced
        }
        folderId = existing.id;
      } else {
        // Create new folder
        folderId = await createDriveFolder(folderName);
        result.foldersCreated++;
        console.log(`[Ring Sync] 📁 Created folder: ${folderName}`);
      }

      // Upload photos
      // List existing files in folder to avoid duplicates
      const drive = getDriveClient();
      const existingFiles = new Set<string>();
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
          if (f.name) existingFiles.add(f.name);
        }
        pageToken = resp.data.nextPageToken || undefined;
      } while (pageToken);

      // Upload missing files
      let uploadedForAlbum = 0;
      for (const fileName of imageFiles) {
        if (existingFiles.has(fileName)) continue;

        try {
          const fileUrl = `${UPLOADS_BASE_URL}/${album.numFacture}/${fileName}`;
          await uploadFileToDrive(folderId, fileName, fileUrl);
          uploadedForAlbum++;
          result.photosUploaded++;
        } catch (e: any) {
          result.errors.push(`Upload failed ${album.numFacture}/${fileName}: ${e.message}`);
        }
      }

      if (uploadedForAlbum > 0) {
        console.log(`[Ring Sync] 📷 ${folderName}: uploaded ${uploadedForAlbum} photos`);
      }
    } catch (e: any) {
      result.errors.push(`Album ${album.numFacture} error: ${e.message}`);
    }
  }

  return result;
}

// ─── Cron control ────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startRingPhotosSync(): void {
  if (!CRM_EMAIL || !CRM_PASSWORD) {
    console.log('[Ring Sync] CRM credentials not configured, sync disabled');
    return;
  }

  if (!isDriveConfigured()) {
    console.log('[Ring Sync] Google Drive not configured, sync disabled');
    return;
  }

  const intervalMs = 60 * 60 * 1000; // 1 hour

  // Initial sync after 60 seconds (let Drive scan run first)
  setTimeout(async () => {
    try {
      const result = await syncRingPhotos();
      console.log(
        `[Ring Sync] Initial: found=${result.albumsFound}, created=${result.foldersCreated}, ` +
        `uploaded=${result.photosUploaded}, skipped=${result.albumsSkipped}`
      );
      if (result.errors.length > 0) {
        console.warn('[Ring Sync] Errors:', result.errors.slice(0, 5));
      }
    } catch (e) {
      console.error('[Ring Sync] Initial sync error:', e);
    }
  }, 60_000);

  // Periodic sync every hour
  syncInterval = setInterval(async () => {
    try {
      const result = await syncRingPhotos();
      console.log(
        `[Ring Sync] Sync: found=${result.albumsFound}, created=${result.foldersCreated}, ` +
        `uploaded=${result.photosUploaded}, skipped=${result.albumsSkipped}`
      );
      if (result.errors.length > 0) {
        console.warn('[Ring Sync] Errors:', result.errors.slice(0, 5));
      }
    } catch (e) {
      console.error('[Ring Sync] Sync error:', e);
    }
  }, intervalMs);

  console.log('⏰ CRON: Ring photos sync every 60 min');
}

export function stopRingPhotosSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Ring Sync] Sync stopped');
  }
}

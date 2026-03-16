import { google } from 'googleapis';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';

let scanInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get authenticated Google Drive client using the same service account as Calendar
 */
function getDriveClient() {
  if (!config.googleCalendar.serviceAccountBase64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 non configuré');
  }

  const credentials = JSON.parse(
    Buffer.from(config.googleCalendar.serviceAccountBase64, 'base64').toString('utf-8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive',
    ],
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * Check if Google Drive integration is configured and enabled
 */
export function isDriveConfigured(): boolean {
  return !!(
    config.googleDrive.enabled &&
    config.googleDrive.parentFolderId &&
    config.googleCalendar.serviceAccountBase64
  );
}

/**
 * Normalize a string for fuzzy matching: strip accents, lowercase, remove special chars
 */
function normalizeForMatch(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two client names match (case-insensitive, accent-insensitive, substring)
 */
function namesMatch(folderName: string, bookingName: string): boolean {
  const a = normalizeForMatch(folderName);
  const b = normalizeForMatch(bookingName);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Parse a folder name in format "JJ.MM.AAAA Nom client"
 * Returns the date and client name, or null if format doesn't match
 */
function parseFolderName(name: string): { date: Date; clientName: string } | null {
  const match = name.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(.+)$/);
  if (!match) return null;

  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const year = parseInt(match[3]!, 10);
  const clientName = match[4]!.trim();

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  return { date, clientName };
}

/**
 * Check if a date falls within a booking's date range (startDate to endDate)
 */
function dateInRange(date: Date, startDate: Date, endDate: Date | null): boolean {
  const d = date.getTime();
  const start = startDate.getTime();
  const end = endDate ? endDate.getTime() : start;
  return d >= start && d <= end;
}

/**
 * List all folders in the parent Drive folder (flat, no subfolders)
 */
async function listDriveFolders(): Promise<Array<{ id: string; name: string; webViewLink: string }>> {
  const drive = getDriveClient();
  const parentId = config.googleDrive.parentFolderId;
  const folders: Array<{ id: string; name: string; webViewLink: string }> = [];

  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, webViewLink)',
      pageSize: 1000,
      supportsAllDrives: true,
      ...(pageToken && { pageToken }),
    });

    for (const file of response.data.files || []) {
      if (file.id && file.name) {
        folders.push({
          id: file.id,
          name: file.name,
          webViewLink: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
        });
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return folders;
}

/**
 * Count files recursively in a Google Drive folder (includes subfolders)
 */
export async function countFolderFiles(folderId: string): Promise<number> {
  const drive = getDriveClient();

  // Get all items in this folder
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, mimeType)',
    pageSize: 1000,
    supportsAllDrives: true,
  });

  const files = response.data.files || [];
  let count = 0;

  for (const file of files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      // Recurse into subfolder
      count += await countFolderFiles(file.id!);
    } else {
      count++;
    }
  }

  return count;
}

/**
 * Scan the parent Drive folder and match folders to bookings.
 * Folder format: "JJ.MM.AAAA Nom client"
 * Matching: date falls within booking date range + client name fuzzy match
 */
export async function scanAndMatchDriveFolders(): Promise<{ matched: number; photoCountsUpdated: number; debug?: unknown }> {
  if (!isDriveConfigured()) {
    console.log('[Drive Scan] Drive non configuré, scan ignoré');
    return { matched: 0, photoCountsUpdated: 0 };
  }

  console.log('[Drive Scan] Début du scan des dossiers Drive...');

  // Get all folders from Drive
  const driveFolders = await listDriveFolders();
  console.log(`[Drive Scan] ${driveFolders.length} dossiers trouvés dans le parent folder`);

  // Parse folders into structured data
  const parsedFolders = driveFolders
    .map(f => ({ ...f, parsed: parseFolderName(f.name) }))
    .filter(f => f.parsed !== null) as Array<{
      id: string; name: string; webViewLink: string;
      parsed: { date: Date; clientName: string };
    }>;

  console.log(`[Drive Scan] ${parsedFolders.length} dossiers au format JJ.MM.AAAA reconnus`);

  // Get all bookings (with or without galleryUrl to allow re-matching)
  const bookings = await prisma.booking.findMany({
    select: {
      id: true,
      customerName: true,
      eventDate: true,
      eventEndDate: true,
      galleryUrl: true,
      driveFolderId: true,
    },
  });

  let matched = 0;
  let photoCountsUpdated = 0;

  for (const folder of parsedFolders) {
    console.log(`[Drive Scan] Checking folder: "${folder.name}" → date=${folder.parsed.date.toISOString()}, client="${folder.parsed.clientName}"`);
    // Try to find a matching booking
    const matchedBooking = bookings.find(b => {
      // Skip if already matched to this exact folder
      if (b.driveFolderId === folder.id) return false;
      const dateOk = dateInRange(folder.parsed.date, b.eventDate, b.eventEndDate);
      const nameOk = namesMatch(folder.parsed.clientName, b.customerName);
      if (dateOk || nameOk) {
        console.log(`[Drive Scan]   vs booking "${b.customerName}" (${b.eventDate.toISOString()} - ${b.eventEndDate?.toISOString() || 'null'}): date=${dateOk}, name=${nameOk}`);
      }
      if (!dateOk) return false;
      return nameOk;
    });

    if (matchedBooking) {
      // Count photos in this folder
      const photoCount = await countFolderFiles(folder.id);

      await prisma.booking.update({
        where: { id: matchedBooking.id },
        data: {
          galleryUrl: folder.webViewLink,
          driveFolderId: folder.id,
          photoCount,
        },
      });

      // Update local ref so we don't re-match
      matchedBooking.driveFolderId = folder.id;
      matchedBooking.galleryUrl = folder.webViewLink;

      matched++;
      console.log(`[Drive Scan] ✅ Match: "${folder.name}" → booking "${matchedBooking.customerName}"`);
    }
  }

  // Update photo counts for all already-matched bookings
  const matchedBookings = await prisma.booking.findMany({
    where: { driveFolderId: { not: null } },
    select: { id: true, driveFolderId: true, photoCount: true },
  });

  for (const b of matchedBookings) {
    try {
      const count = await countFolderFiles(b.driveFolderId!);
      if (count !== b.photoCount) {
        await prisma.booking.update({
          where: { id: b.id },
          data: { photoCount: count },
        });
        photoCountsUpdated++;
      }
    } catch (e) {
      console.error(`[Drive Scan] Erreur comptage photos pour booking ${b.id}:`, e);
    }
  }

  const debugInfo = {
    totalDriveFolders: driveFolders.length,
    parsedFolders: parsedFolders.map(f => ({ name: f.name, date: f.parsed.date.toISOString(), client: f.parsed.clientName })),
    bookingsCount: bookings.length,
    bookingSample: bookings.slice(0, 5).map(b => ({ id: b.id, name: b.customerName, start: b.eventDate.toISOString(), end: b.eventEndDate?.toISOString() || null, driveFolderId: b.driveFolderId, galleryUrl: b.galleryUrl ? 'set' : null })),
  };

  console.log(`[Drive Scan] Terminé: ${matched} nouveaux matchs, ${photoCountsUpdated} compteurs mis à jour`);
  return { matched, photoCountsUpdated, debug: debugInfo };
}

/**
 * Start periodic Drive folder scanning
 */
export function startDriveFolderSync(): void {
  if (!isDriveConfigured()) {
    console.log('[Drive Scan] Drive non configuré, sync désactivée');
    return;
  }

  const intervalMinutes = config.googleDrive.scanIntervalMinutes || 30;

  // Initial scan after 20 seconds
  setTimeout(async () => {
    try {
      await scanAndMatchDriveFolders();
    } catch (e) {
      console.error('[Drive Scan] Erreur lors du scan initial:', e);
    }
  }, 20_000);

  // Periodic scan
  scanInterval = setInterval(async () => {
    try {
      await scanAndMatchDriveFolders();
    } catch (e) {
      console.error('[Drive Scan] Erreur lors du scan périodique:', e);
    }
  }, intervalMinutes * 60_000);

  console.log(`[Drive Scan] Sync démarrée — scan toutes les ${intervalMinutes} minutes`);
}

/**
 * Stop periodic Drive folder scanning
 */
export function stopDriveFolderSync(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log('[Drive Scan] Sync arrêtée');
  }
}

/**
 * List image thumbnails from a Google Drive folder (by folder URL).
 * Returns thumbnail URLs (max 20) and total file count in folder.
 */
export async function listFolderThumbnails(galleryUrl: string): Promise<{ thumbnails: string[]; totalCount: number }> {
  const match = galleryUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) return { thumbnails: [], totalCount: 0 };

  const folderId = match[1];
  const drive = getDriveClient();

  // Get total count of all files (images + videos)
  const countResponse = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id)',
    pageSize: 1000,
    supportsAllDrives: true,
  });
  const totalCount = countResponse.data.files?.length || 0;

  // Get thumbnails for preview (max 20 images)
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id, thumbnailLink)',
    pageSize: 20,
    supportsAllDrives: true,
    orderBy: 'createdTime desc',
  });

  const thumbnails = (response.data.files || [])
    .filter(f => f.thumbnailLink)
    .map(f => f.thumbnailLink!.replace(/=s\d+/, '=s400'));

  return { thumbnails, totalCount };
}

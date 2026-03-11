import { google } from 'googleapis';
import { config } from '../config/index.js';

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
 * Find or create a subfolder by name inside a given parent folder.
 * Returns the subfolder ID.
 */
async function getOrCreateSubfolder(drive: ReturnType<typeof getDriveClient>, parentId: string, name: string): Promise<string> {
  const existing = await drive.files.list({
    q: `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0]!.id!;
  }

  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const folderId = response.data.id!;

  // Monthly subfolder also publicly accessible
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  console.log(`[Google Drive] Sous-dossier mensuel créé: "${name}" (${folderId})`);
  return folderId;
}

/**
 * Build the monthly subfolder name from a date string.
 * Format: "YYYY-MM" (e.g. "2026-03")
 */
function getMonthlyFolderName(startDate: string): string {
  // startDate is "YYYY-MM-DD"
  return startDate.substring(0, 7);
}

/**
 * Create a folder in Google Drive inside a monthly subfolder.
 * Structure: parentFolder / YYYY-MM / eventFolder
 * Returns the folder ID and shareable URL.
 */
export async function createDriveFolder(folderName: string, startDate?: string): Promise<{
  folderId: string;
  folderUrl: string;
}> {
  const drive = getDriveClient();
  const rootParentId = config.googleDrive.parentFolderId;

  // Determine the actual parent: monthly subfolder if startDate provided
  let parentFolderId = rootParentId;
  if (startDate) {
    const monthlyName = getMonthlyFolderName(startDate);
    parentFolderId = await getOrCreateSubfolder(drive, rootParentId, monthlyName);
  }

  // Check if folder already exists with same name in parent
  const existing = await drive.files.list({
    q: `name = '${folderName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    supportsAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    const file = existing.data.files[0]!;
    console.log(`[Google Drive] Dossier existant: "${folderName}" (${file.id})`);
    return {
      folderId: file.id!,
      folderUrl: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
    };
  }

  // Create new folder
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  const folderId = response.data.id!;
  const folderUrl = response.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;

  // Set sharing: anyone with the link can view
  await drive.permissions.create({
    fileId: folderId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
    supportsAllDrives: true,
  });

  console.log(`[Google Drive] Dossier créé: "${folderName}" → ${folderUrl}`);

  return { folderId, folderUrl };
}

/**
 * Build a folder name from event data
 * Format: "JJ.MM Nom du client"
 */
export function buildFolderName(clientName: string, startDate: string, _produitNom?: string | null): string {
  // startDate is "YYYY-MM-DD"
  const [, month, day] = startDate.split('-');
  const name = `${day}.${month} ${clientName}`;
  // Sanitize: remove chars not allowed in Drive folder names
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Rename an existing Google Drive folder.
 * Extracts the folder ID from the galleryUrl.
 */
export async function renameDriveFolder(galleryUrl: string, newName: string): Promise<void> {
  const match = galleryUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    console.error(`[Google Drive] Impossible d'extraire l'ID du dossier depuis: ${galleryUrl}`);
    return;
  }

  const folderId = match[1];
  const drive = getDriveClient();
  const sanitizedName = newName.replace(/[/\\:*?"<>|]/g, '_');

  await drive.files.update({
    fileId: folderId,
    requestBody: { name: sanitizedName },
    supportsAllDrives: true,
  });

  console.log(`[Google Drive] Dossier renommé: "${sanitizedName}" (${folderId})`);
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

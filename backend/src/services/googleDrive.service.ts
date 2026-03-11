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
 * Create a folder in Google Drive inside the parent folder
 * Returns the folder ID and shareable URL
 */
export async function createDriveFolder(folderName: string): Promise<{
  folderId: string;
  folderUrl: string;
}> {
  const drive = getDriveClient();
  const parentFolderId = config.googleDrive.parentFolderId;

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
 * Format: "YYYY-MM-DD - ClientName (Produit)"
 */
export function buildFolderName(clientName: string, startDate: string, produitNom?: string | null): string {
  const parts = [startDate, clientName];
  if (produitNom) {
    parts.push(`(${produitNom})`);
  }
  // Sanitize: remove chars not allowed in Drive folder names
  return parts.join(' - ').replace(/[/\\:*?"<>|]/g, '_');
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

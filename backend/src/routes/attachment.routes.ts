import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { authenticate } from '../middlewares/auth.middleware.js';
import { config } from '../config/index.js';

const router = Router();

function getDriveClient() {
  if (!config.googleCalendar.serviceAccountBase64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 non configuré');
  }
  const credentials = JSON.parse(
    Buffer.from(config.googleCalendar.serviceAccountBase64, 'base64').toString('utf-8')
  );
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * GET /api/attachments/:fileId/download
 * Proxy Google Drive file download through the backend
 */
router.get('/:fileId/download', authenticate, async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const drive = getDriveClient();

    // Get file metadata first
    const meta = await drive.files.get({
      fileId,
      fields: 'name,mimeType,size',
    });

    const fileName = meta.data.name || 'document';
    const mimeType = meta.data.mimeType || 'application/octet-stream';

    // If it's a Google Doc/Sheet/Slide, export as PDF
    const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.');
    let fileStream;

    if (isGoogleDoc) {
      const exportRes = await drive.files.export(
        { fileId, mimeType: 'application/pdf' },
        { responseType: 'stream' }
      );
      fileStream = exportRes.data;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}.pdf"`);
    } else {
      const downloadRes = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      fileStream = downloadRes.data;
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    }

    (fileStream as NodeJS.ReadableStream).pipe(res);
  } catch (error: any) {
    console.error('Error downloading attachment:', error.message);
    if (error.code === 404) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }
    return res.status(500).json({ error: 'Erreur lors du téléchargement' });
  }
});

export default router;

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
 * GET /api/attachments/debug
 * Debug: check if Google Calendar returns attachments (public for testing)
 */
router.get('/debug', authenticate, async (_req: Request, res: Response) => {
  try {
    const credentials = JSON.parse(
      Buffer.from(config.googleCalendar.serviceAccountBase64!, 'base64').toString('utf-8')
    );
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarIds = config.googleCalendar.calendarIds;
    const now = new Date();
    const timeMin = now.toISOString();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const timeMax = future.toISOString();

    const results: any[] = [];
    for (const calId of calendarIds) {
      const response = await calendar.events.list({
        calendarId: calId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 10,
        supportsAttachments: true,
      } as any);
      for (const ev of (response.data.items || []) as any[]) {
        results.push({
          summary: ev.summary,
          hasAttachments: !!ev.attachments,
          attachmentsCount: ev.attachments?.length || 0,
          attachments: ev.attachments || [],
          keys: Object.keys(ev),
        });
      }
    }
    return res.json({ events: results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attachments/:fileId/download
 * Proxy Google Drive file download through the backend
 */
router.get('/:fileId/download', async (req: Request, res: Response): Promise<any> => {
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

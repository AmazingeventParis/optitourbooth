import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { config } from '../config/index.js';

const router = Router();

// Require admin or superadmin authentication
router.use(authenticate, requireRole('admin', 'superadmin'));

/**
 * GET /api/google-auth/authorize
 * Generates a Google OAuth2 authorization URL for Drive readonly access.
 * The user must visit this URL to grant consent and get a refresh token.
 */
router.get('/authorize', (req: Request, res: Response) => {
  const { oauthClientId, oauthClientSecret } = config.googleCalendar;

  if (!oauthClientId || !oauthClientSecret) {
    return res.status(400).json({
      error: 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured',
    });
  }

  const redirectUri = `https://${req.get('host')}/api/google-auth/callback`;

  const oauth2Client = new google.auth.OAuth2(
    oauthClientId,
    oauthClientSecret,
    redirectUri
  );

  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return res.json({ url: authorizationUrl });
});

/**
 * GET /api/google-auth/callback
 * Receives the authorization code from Google, exchanges it for tokens,
 * and displays the refresh token for the user to add to environment variables.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  const { oauthClientId, oauthClientSecret } = config.googleCalendar;

  if (!oauthClientId || !oauthClientSecret) {
    return res.status(400).json({
      error: 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured',
    });
  }

  const redirectUri = `https://${req.get('host')}/api/google-auth/callback`;

  const oauth2Client = new google.auth.OAuth2(
    oauthClientId,
    oauthClientSecret,
    redirectUri
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token || '';

    console.log('[Google OAuth] Token exchange successful. Refresh token obtained:', refreshToken ? 'yes' : 'no');

    // Return an HTML page showing the refresh token
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google OAuth - Success</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; background: #f5f5f5; }
    .card { background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #16a34a; margin-top: 0; }
    .token-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 12px; word-break: break-all; font-family: monospace; font-size: 13px; margin: 12px 0; }
    .warning { background: #fef3c7; border: 1px solid #fde68a; border-radius: 4px; padding: 12px; margin: 12px 0; }
    .env-example { background: #f1f5f9; border-radius: 4px; padding: 12px; font-family: monospace; font-size: 13px; margin: 12px 0; }
    code { background: #e2e8f0; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Google OAuth Authorization Successful</h1>
    <p>Access to Google Drive has been granted.</p>

    ${refreshToken ? `
    <h3>Refresh Token</h3>
    <div class="token-box">${refreshToken}</div>

    <h3>Add to Environment Variables</h3>
    <div class="env-example">GOOGLE_OAUTH_REFRESH_TOKEN=${refreshToken}</div>

    <div class="warning">
      <strong>Important:</strong> Copy this refresh token and add it to your environment variables (Coolify or .env file).
      This token will not be shown again. Once configured, the backend will use OAuth2 credentials
      to access Google Drive files from the personal account.
    </div>
    ` : `
    <div class="warning">
      <strong>Warning:</strong> No refresh token was returned. This can happen if consent was previously granted.
      Try revoking access at <a href="https://myaccount.google.com/permissions">Google Account Permissions</a>
      and then authorize again.
    </div>
    `}

    <p>Access token: <code>${tokens.access_token ? 'obtained' : 'none'}</code></p>
    <p>Token type: <code>${tokens.token_type || 'N/A'}</code></p>
    <p>Expires: <code>${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A'}</code></p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (error: any) {
    console.error('[Google OAuth] Token exchange error:', error.message);
    return res.status(500).json({
      error: 'Failed to exchange authorization code for tokens',
      details: error.message,
    });
  }
});

export default router;

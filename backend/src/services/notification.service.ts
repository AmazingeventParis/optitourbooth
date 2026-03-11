import webpush from 'web-push';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { socketEmit } from '../config/socket.js';

// Configure VAPID keys
let vapidConfigured = false;
if (config.webPush.publicKey && config.webPush.privateKey) {
  try {
    webpush.setVapidDetails(
      config.webPush.subject,
      config.webPush.publicKey,
      config.webPush.privateKey
    );
    vapidConfigured = true;
  } catch (error) {
    console.warn('[Push] Invalid VAPID keys, push notifications disabled:', (error as Error).message);
  }
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Notify a chauffeur via all 3 channels:
 * 1. DB notification (persistent, shown in notification list)
 * 2. Socket event (real-time in-app toast + badge update)
 * 3. Web Push (browser/OS notification even when app is closed)
 */
async function notifyChauffeur(
  chauffeurId: string,
  type: string,
  title: string,
  body: string,
  url?: string,
  metadata?: Record<string, string>
): Promise<void> {
  // 1. Create persistent DB notification
  const dbNotif = await prisma.notification.create({
    data: {
      userId: chauffeurId,
      type,
      title,
      body,
      metadata: metadata || undefined,
    },
  });

  // 2. Emit socket event for real-time in-app display
  socketEmit.toUser(chauffeurId, 'notification:new', {
    id: dbNotif.id,
    type,
    title,
    body,
    metadata,
    read: false,
    createdAt: dbNotif.createdAt.toISOString(),
  });

  // Also emit tournee:updated for backward compat (triggers tournee refresh)
  if (type.startsWith('tournee_') || type.startsWith('point_')) {
    socketEmit.toUser(chauffeurId, 'tournee:updated', {
      action: type,
      message: body,
    });
  }

  // 3. Send Web Push notification (VAPID)
  if (vapidConfigured) {
    sendPushToUser(chauffeurId, { title, body, url }).catch((err) => {
      console.warn(`[Push Web] Failed for user ${chauffeurId}:`, (err as Error).message);
    });
  }

  // 4. Send native push notification (APNs/FCM)
  sendNativePushToUser(chauffeurId, { title, body, url }).catch((err) => {
    console.warn(`[Push Native] Failed for user ${chauffeurId}:`, (err as Error).message);
  });
}

async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) return;

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        );
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
        throw error;
      }
    })
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[Push] ${sent} sent, ${failed} failed for user ${userId}`);
  }
}

/**
 * Send native push notifications via APNs (iOS) using the App Store Connect API key.
 * For now, we store tokens and will integrate with APNs HTTP/2 when tokens exist.
 */
async function sendNativePushToUser(userId: string, payload: PushPayload): Promise<void> {
  const tokens = await prisma.nativePushToken.findMany({
    where: { userId },
  });

  if (tokens.length === 0) return;

  for (const tokenRecord of tokens) {
    try {
      if (tokenRecord.platform === 'ios') {
        await sendAPNs(tokenRecord.token, payload);
      }
      // Android FCM can be added here later
    } catch (error) {
      console.warn(`[Push Native] Failed for token ${tokenRecord.token.slice(0, 10)}...:`, (error as Error).message);
      // Remove invalid tokens
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 400) {
        await prisma.nativePushToken.delete({ where: { id: tokenRecord.id } }).catch(() => {});
      }
    }
  }
}

/**
 * Send a push notification via APNs HTTP/2
 * Uses the App Store Connect API key (same .p8) for token-based auth
 */
async function sendAPNs(deviceToken: string, payload: PushPayload): Promise<void> {
  const apnsKeyId = process.env.APNS_KEY_ID || process.env.APP_STORE_CONNECT_KEY_IDENTIFIER;
  const apnsTeamId = process.env.APNS_TEAM_ID || process.env.APPLE_TEAM_ID;
  const apnsPrivateKey = process.env.APNS_PRIVATE_KEY || process.env.APP_STORE_CONNECT_PRIVATE_KEY;
  const bundleId = 'app.swipego.optitourbooth';

  if (!apnsKeyId || !apnsTeamId || !apnsPrivateKey) {
    // APNs not configured, skip silently
    return;
  }

  // Build JWT for APNs
  const jwt = await buildAPNsJWT(apnsKeyId, apnsTeamId, apnsPrivateKey);

  const apnsPayload = JSON.stringify({
    aps: {
      alert: {
        title: payload.title,
        body: payload.body,
      },
      sound: 'default',
      badge: 1,
    },
    url: payload.url,
  });

  // Use production APNs endpoint
  const url = `https://api.push.apple.com/3/device/${deviceToken}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: apnsPayload,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new Error(`APNs error ${response.status}: ${errorBody}`) as Error & { statusCode: number };
    error.statusCode = response.status;
    throw error;
  }
}

// Cache the APNs JWT (valid for 1 hour, we refresh every 50 min)
let cachedAPNsJWT: { token: string; expiresAt: number } | null = null;

async function buildAPNsJWT(keyId: string, teamId: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedAPNsJWT && cachedAPNsJWT.expiresAt > now) {
    return cachedAPNsJWT.token;
  }

  // Build JWT manually using crypto (ES256)
  const crypto = await import('crypto');

  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString('base64url');
  const signingInput = `${header}.${claims}`;

  const key = crypto.createPrivateKey(privateKey);
  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const derSignature = sign.sign(key);

  // Convert DER to raw r||s format for ES256
  const rawSig = derToRaw(derSignature);
  const signature = Buffer.from(rawSig).toString('base64url');

  const token = `${signingInput}.${signature}`;
  cachedAPNsJWT = { token, expiresAt: now + 3000 }; // Cache for 50 min
  return token;
}

/** Convert DER-encoded ECDSA signature to raw r||s (64 bytes) */
function derToRaw(der: Buffer): Buffer {
  // DER: 0x30 [len] 0x02 [rLen] [r] 0x02 [sLen] [s]
  let offset = 2; // skip 0x30 and total length
  if (der[1]! > 0x80) offset += der[1]! - 0x80;

  // Read r
  offset++; // skip 0x02
  let rLen = der[offset]!;
  offset++;
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;

  // Read s
  offset++; // skip 0x02
  let sLen = der[offset]!;
  offset++;
  let s = der.subarray(offset, offset + sLen);

  // Remove leading zeros
  if (r.length > 32) r = r.subarray(r.length - 32);
  if (s.length > 32) s = s.subarray(s.length - 32);

  // Pad to 32 bytes
  const raw = Buffer.alloc(64);
  r.copy(raw, 32 - r.length);
  s.copy(raw, 64 - s.length);
  return raw;
}

export const notificationService = {
  /**
   * Subscribe a user to web push notifications (VAPID)
   */
  async subscribe(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  },

  /**
   * Subscribe a native push token (APNs/FCM from Capacitor app)
   */
  async subscribeNative(userId: string, token: string, platform: string) {
    return prisma.nativePushToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  },

  /**
   * Unsubscribe an endpoint
   */
  async unsubscribe(endpoint: string) {
    return prisma.pushSubscription.deleteMany({
      where: { endpoint },
    });
  },

  /**
   * Send a push notification to a specific user (all their devices)
   * Used for direct push-only notifications (backward compat)
   */
  async sendToUser(userId: string, payload: PushPayload) {
    if (!vapidConfigured) return;
    await sendPushToUser(userId, payload);
  },

  // ========== Business notification methods ==========
  // Each one: DB + Socket + Web Push

  async notifyTourneeCreated(chauffeurId: string, date: string, nbPoints: number) {
    const dateFormatted = formatDateFR(date);
    await notifyChauffeur(
      chauffeurId,
      'tournee_created',
      'Nouvelle tournée',
      `Une tournée pour le ${dateFormatted} vous a été assignée avec ${nbPoints} point(s).`,
      '/chauffeur',
      { date }
    );
  },

  async notifyTourneeUpdated(chauffeurId: string, date: string, detail: string) {
    const dateFormatted = formatDateFR(date);
    await notifyChauffeur(
      chauffeurId,
      'tournee_updated',
      'Tournée modifiée',
      `Votre tournée du ${dateFormatted} a été modifiée : ${detail}`,
      '/chauffeur',
      { date, detail }
    );
  },

  async notifyPointAdded(chauffeurId: string, date: string, clientName: string) {
    const dateFormatted = formatDateFR(date);
    await notifyChauffeur(
      chauffeurId,
      'point_added',
      'Point ajouté',
      `Un point chez ${clientName} a été ajouté à votre tournée du ${dateFormatted}.`,
      '/chauffeur/tournee',
      { date, clientName }
    );
  },

  async notifyPointRemoved(chauffeurId: string, date: string) {
    const dateFormatted = formatDateFR(date);
    await notifyChauffeur(
      chauffeurId,
      'point_removed',
      'Point retiré',
      `Un point a été retiré de votre tournée du ${dateFormatted}.`,
      '/chauffeur/tournee',
      { date }
    );
  },

  async notifyPointMovedIn(chauffeurId: string, date: string, clientName: string) {
    const dateFormatted = formatDateFR(date);
    await notifyChauffeur(
      chauffeurId,
      'point_moved_in',
      'Point transféré',
      `Un point chez ${clientName} a été transféré vers votre tournée du ${dateFormatted}.`,
      '/chauffeur/tournee',
      { date, clientName }
    );
  },

  async notifyPointMovedOut(chauffeurId: string, date: string) {
    const dateFormatted = formatDateFR(date);
    await notifyChauffeur(
      chauffeurId,
      'point_moved_out',
      'Point déplacé',
      `Un point a été déplacé hors de votre tournée du ${dateFormatted}.`,
      '/chauffeur/tournee',
      { date }
    );
  },

  async notifyPointsReordered(chauffeurId: string, date: string) {
    const dateFormatted = formatDateFR(date);
    await notifyChauffeur(
      chauffeurId,
      'points_reordered',
      'Ordre modifié',
      `L'ordre des points de votre tournée du ${dateFormatted} a été modifié.`,
      '/chauffeur/tournee',
      { date }
    );
  },
};

/** Format ISO date to DD/MM/YYYY */
function formatDateFR(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

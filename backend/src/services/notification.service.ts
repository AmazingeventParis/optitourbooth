import webpush from 'web-push';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';

// Configure VAPID keys
if (config.webPush.publicKey && config.webPush.privateKey) {
  webpush.setVapidDetails(
    config.webPush.subject,
    config.webPush.publicKey,
    config.webPush.privateKey
  );
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export const notificationService = {
  /**
   * Subscribe a user to push notifications
   */
  async subscribe(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    // Upsert: update if endpoint exists, create otherwise
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
   * Unsubscribe an endpoint
   */
  async unsubscribe(endpoint: string) {
    return prisma.pushSubscription.deleteMany({
      where: { endpoint },
    });
  },

  /**
   * Send a push notification to a specific user (all their devices)
   */
  async sendToUser(userId: string, payload: PushPayload) {
    if (!config.webPush.publicKey || !config.webPush.privateKey) {
      return; // VAPID not configured, silently skip
    }

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

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
          // 404 or 410 = subscription expired/invalid, remove it
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
  },

  // ========== Business notification methods ==========

  async notifyTourneeCreated(chauffeurId: string, date: string, nbPoints: number) {
    const dateFormatted = formatDateFR(date);
    await this.sendToUser(chauffeurId, {
      title: 'Nouvelle tournée',
      body: `Une tournée pour le ${dateFormatted} vous a été assignée avec ${nbPoints} point(s).`,
      url: '/chauffeur',
    });
  },

  async notifyTourneeUpdated(chauffeurId: string, date: string, detail: string) {
    const dateFormatted = formatDateFR(date);
    await this.sendToUser(chauffeurId, {
      title: 'Tournée modifiée',
      body: `Votre tournée du ${dateFormatted} a été modifiée : ${detail}`,
      url: '/chauffeur',
    });
  },

  async notifyPointAdded(chauffeurId: string, date: string, clientName: string) {
    const dateFormatted = formatDateFR(date);
    await this.sendToUser(chauffeurId, {
      title: 'Point ajouté',
      body: `Un point chez ${clientName} a été ajouté à votre tournée du ${dateFormatted}.`,
      url: '/chauffeur/tournee',
    });
  },

  async notifyPointRemoved(chauffeurId: string, date: string) {
    const dateFormatted = formatDateFR(date);
    await this.sendToUser(chauffeurId, {
      title: 'Point retiré',
      body: `Un point a été retiré de votre tournée du ${dateFormatted}.`,
      url: '/chauffeur/tournee',
    });
  },

  async notifyPointMovedIn(chauffeurId: string, date: string, clientName: string) {
    const dateFormatted = formatDateFR(date);
    await this.sendToUser(chauffeurId, {
      title: 'Point transféré',
      body: `Un point chez ${clientName} a été transféré vers votre tournée du ${dateFormatted}.`,
      url: '/chauffeur/tournee',
    });
  },

  async notifyPointMovedOut(chauffeurId: string, date: string) {
    const dateFormatted = formatDateFR(date);
    await this.sendToUser(chauffeurId, {
      title: 'Point déplacé',
      body: `Un point a été déplacé hors de votre tournée du ${dateFormatted}.`,
      url: '/chauffeur/tournee',
    });
  },

  async notifyPointsReordered(chauffeurId: string, date: string) {
    const dateFormatted = formatDateFR(date);
    await this.sendToUser(chauffeurId, {
      title: 'Ordre modifié',
      body: `L'ordre des points de votre tournée du ${dateFormatted} a été modifié.`,
      url: '/chauffeur/tournee',
    });
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

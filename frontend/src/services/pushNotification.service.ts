import api from './api';

class PushNotificationService {
  private vapidPublicKey: string | null = null;

  /**
   * Initialize push notifications: fetch VAPID key, request permission, subscribe
   */
  async init(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Push notifications not supported');
      return false;
    }

    try {
      // Get VAPID public key from server
      const { data } = await api.get('/notifications/vapid-public-key');
      this.vapidPublicKey = data.data.publicKey;

      if (!this.vapidPublicKey) {
        console.warn('[Push] No VAPID public key configured on server');
        return false;
      }

      // Check if already subscribed
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();

      if (existing) {
        // Already subscribed, send to server in case it's a new device/token
        await this.sendSubscriptionToServer(existing);
        return true;
      }

      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.info('[Push] Notification permission denied');
        return false;
      }

      // Subscribe
      return this.subscribe();
    } catch (error) {
      console.error('[Push] Init failed:', error);
      return false;
    }
  }

  /**
   * Subscribe to push notifications
   */
  async subscribe(): Promise<boolean> {
    if (!this.vapidPublicKey) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey).buffer as ArrayBuffer,
      });

      await this.sendSubscriptionToServer(subscription);
      return true;
    } catch (error) {
      console.error('[Push] Subscribe failed:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await api.delete('/notifications/unsubscribe', {
          data: { endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }
    } catch (error) {
      console.error('[Push] Unsubscribe failed:', error);
    }
  }

  /**
   * Check if currently subscribed
   */
  async isSubscribed(): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return !!subscription;
    } catch {
      return false;
    }
  }

  private async sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON();
    await api.post('/notifications/subscribe', {
      endpoint: json.endpoint,
      keys: {
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      },
    });
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

export const pushNotificationService = new PushNotificationService();

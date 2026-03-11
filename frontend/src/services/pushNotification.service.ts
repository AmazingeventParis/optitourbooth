import api from './api';
import { Capacitor } from '@capacitor/core';

/**
 * Detect if running inside a native Capacitor app
 */
const isNative = Capacitor.isNativePlatform();

// ==================== Native (iOS/Android via Capacitor) ====================

async function initNative(): Promise<boolean> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.info('[Push Native] Permission denied');
      return false;
    }

    // Register with APNs / FCM
    await PushNotifications.register();

    // Listen for registration token
    PushNotifications.addListener('registration', async (token) => {
      console.info('[Push Native] Token:', token.value);
      // Send the native token to our backend
      try {
        await api.post('/notifications/subscribe-native', {
          token: token.value,
          platform: Capacitor.getPlatform(), // 'ios' or 'android'
        });
      } catch (err) {
        console.error('[Push Native] Failed to send token to server:', err);
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push Native] Registration error:', err);
    });

    // Foreground notification handling
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.info('[Push Native] Received in foreground:', notification);
      // In-app notifications are handled by socket, this is just for when
      // the push arrives while app is open
    });

    // Notification tap handler
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.info('[Push Native] Tapped:', action);
      // Could navigate to a specific page based on action.notification.data
    });

    return true;
  } catch (error) {
    console.error('[Push Native] Init failed:', error);
    return false;
  }
}

async function isSubscribedNative(): Promise<boolean> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    return perm.receive === 'granted';
  } catch {
    return false;
  }
}

// ==================== Web (Browser via VAPID / Web Push) ====================

let vapidPublicKey: string | null = null;

async function initWeb(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push Web] Push notifications not supported');
    return false;
  }

  try {
    const { data } = await api.get('/notifications/vapid-public-key');
    vapidPublicKey = data.data.publicKey;

    if (!vapidPublicKey) {
      console.warn('[Push Web] No VAPID public key configured on server');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();

    if (existing) {
      await sendWebSubscriptionToServer(existing);
      return true;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.info('[Push Web] Notification permission denied');
      return false;
    }

    return subscribeWeb();
  } catch (error) {
    console.error('[Push Web] Init failed:', error);
    return false;
  }
}

async function subscribeWeb(): Promise<boolean> {
  if (!vapidPublicKey) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
    });

    await sendWebSubscriptionToServer(subscription);
    return true;
  } catch (error) {
    console.error('[Push Web] Subscribe failed:', error);
    return false;
  }
}

async function unsubscribeWeb(): Promise<void> {
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
    console.error('[Push Web] Unsubscribe failed:', error);
  }
}

async function isSubscribedWeb(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

async function sendWebSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await api.post('/notifications/subscribe', {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    },
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ==================== Unified export ====================

class PushNotificationService {
  async init(): Promise<boolean> {
    if (isNative) return initNative();
    return initWeb();
  }

  async isSubscribed(): Promise<boolean> {
    if (isNative) return isSubscribedNative();
    return isSubscribedWeb();
  }

  async unsubscribe(): Promise<void> {
    if (!isNative) return unsubscribeWeb();
    // Native: unsubscribe not typically needed (managed by OS)
  }
}

export const pushNotificationService = new PushNotificationService();

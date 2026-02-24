import { useOfflineStore, OfflineQueueItem } from '@/store/offlineStore';
import api from '@/services/api';

const MAX_RETRIES = 5;

/**
 * Calculate backoff delay: 1s, 2s, 4s, 8s, 16s
 */
function getBackoffDelay(retries: number): number {
  return Math.min(1000 * Math.pow(2, retries), 16000);
}

/**
 * Process a single queue item based on its type
 */
async function processItem(item: OfflineQueueItem): Promise<boolean> {
  switch (item.type) {
    case 'gps-position': {
      await api.post('/gps/position', item.payload);
      return true;
    }
    case 'photo-upload': {
      const { tourneeId, pointId, formData } = item.payload as {
        tourneeId: string;
        pointId: string;
        formData: FormData;
      };
      await api.post(`/tournees/${tourneeId}/points/${pointId}/photos`, formData);
      return true;
    }
    case 'point-completion': {
      const { tourneeId: tId, pointId: pId, data } = item.payload as {
        tourneeId: string;
        pointId: string;
        data: Record<string, unknown>;
      };
      await api.patch(`/tournees/${tId}/points/${pId}`, data);
      return true;
    }
    default:
      console.warn('[OfflineQueue] Unknown item type:', item.type);
      return false;
  }
}

/**
 * Process all items in the offline queue with backoff
 */
export async function processQueue(): Promise<void> {
  const store = useOfflineStore.getState();
  const items = [...store.queue];

  if (items.length === 0) return;

  console.log(`[OfflineQueue] Processing ${items.length} items`);

  for (const item of items) {
    if (item.retries >= MAX_RETRIES) {
      console.warn(`[OfflineQueue] Dropping item ${item.id} after ${MAX_RETRIES} retries`);
      store.removeFromQueue(item.id);
      continue;
    }

    // Wait for backoff delay
    if (item.retries > 0) {
      await new Promise((r) => setTimeout(r, getBackoffDelay(item.retries)));
    }

    try {
      const success = await processItem(item);
      if (success) {
        store.removeFromQueue(item.id);
      }
    } catch (err) {
      console.error(`[OfflineQueue] Failed to process ${item.id}:`, err);
      store.incrementRetries(item.id);
    }
  }
}

/**
 * Register background sync if supported, or listen for online event
 */
export function setupQueueSync(): void {
  // Process queue when coming back online
  window.addEventListener('online', () => {
    setTimeout(processQueue, 1000);
  });

  // Register background sync if supported
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(() => {
      // Listen for SW asking us to process queue
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PROCESS_OFFLINE_QUEUE') {
          processQueue();
        }
      });
    });
  }

  // Process any pending items on startup
  if (navigator.onLine) {
    setTimeout(processQueue, 2000);
  }
}

/**
 * Register a sync tag with the service worker
 */
export async function registerSync(): Promise<void> {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).sync.register('sync-queue');
    } catch {
      // Fallback: process immediately if online
      if (navigator.onLine) {
        processQueue();
      }
    }
  } else if (navigator.onLine) {
    processQueue();
  }
}

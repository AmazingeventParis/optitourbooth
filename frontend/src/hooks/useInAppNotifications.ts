import { useEffect } from 'react';
import { socketService } from '@/services/socket.service';
import { useNotificationStore } from '@/store/notificationStore';
import toast from 'react-hot-toast';

interface SocketNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, string>;
  read: boolean;
  createdAt: string;
}

const ICON_MAP: Record<string, string> = {
  tournee_created: '🚛',
  tournee_updated: '✏️',
  point_added: '📍',
  point_removed: '🗑️',
  point_moved_in: '📥',
  point_moved_out: '📤',
  points_reordered: '🔀',
  preparation_created: '📦',
  preparation_updated: '📦',
};

/**
 * Hook that listens to socket events and creates in-app notifications.
 * Listens to `notification:new` which is emitted by the backend for all
 * DB-backed notifications (tournee changes, point changes, etc.)
 */
export function useInAppNotifications() {
  const addFromSocket = useNotificationStore((s) => s.addFromSocket);

  useEffect(() => {
    const handleNotification = (data: SocketNotification) => {
      // Add to store (uses the DB id, so it won't duplicate on next fetch)
      addFromSocket({
        id: data.id,
        type: data.type,
        title: data.title,
        body: data.body,
        metadata: data.metadata,
        read: false,
        createdAt: data.createdAt,
      });

      // Show toast
      const icon = ICON_MAP[data.type] || 'ℹ️';
      toast(data.body, { icon });
    };

    socketService.on('notification:new', handleNotification);

    return () => {
      socketService.off('notification:new', handleNotification);
    };
  }, [addFromSocket]);
}

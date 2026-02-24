import { useEffect } from 'react';
import { socketService } from '@/services/socket.service';
import { useNotificationStore } from '@/store/notificationStore';
import toast from 'react-hot-toast';

/**
 * Hook that listens to socket events and creates in-app notifications
 */
export function useInAppNotifications() {
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    const handleTourneeAssigned = (data: { tourneeId?: string; message?: string }) => {
      const notif = {
        type: 'tournee_assigned' as const,
        title: 'Nouvelle tournée',
        body: data.message || 'Une tournée vous a été assignée',
      };
      addNotification(notif);
      toast(notif.body, { icon: '🚛' });
    };

    const handlePointModified = (data: { pointId?: string; message?: string }) => {
      const notif = {
        type: 'point_modified' as const,
        title: 'Point modifié',
        body: data.message || 'Un point de votre tournée a été modifié',
      };
      addNotification(notif);
      toast(notif.body, { icon: '📍' });
    };

    const handleAdminMessage = (data: { message?: string; title?: string }) => {
      const notif = {
        type: 'message' as const,
        title: data.title || 'Message',
        body: data.message || 'Nouveau message',
      };
      addNotification(notif);
      toast(notif.body, { icon: '💬' });
    };

    socketService.on('tournee:assigned', handleTourneeAssigned);
    socketService.on('tournee:updated', handlePointModified);
    socketService.on('admin:message', handleAdminMessage);

    return () => {
      socketService.off('tournee:assigned', handleTourneeAssigned);
      socketService.off('tournee:updated', handlePointModified);
      socketService.off('admin:message', handleAdminMessage);
    };
  }, [addNotification]);
}

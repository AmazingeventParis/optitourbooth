import { create } from 'zustand';
import { notificationsService, DbNotification } from '@/services/notifications.service';

export interface AppNotification {
  id: string;
  type: 'tournee_assigned' | 'point_modified' | 'message' | 'info' | 'preparation_created' | 'preparation_updated';
  title: string;
  body: string;
  metadata?: Record<string, string>;
  read: boolean;
  createdAt: number;
}

function dbToApp(n: DbNotification): AppNotification {
  return {
    id: n.id,
    type: n.type as AppNotification['type'],
    title: n.title,
    body: n.body,
    metadata: n.metadata || undefined,
    read: n.read,
    createdAt: new Date(n.createdAt).getTime(),
  };
}

interface NotificationState {
  notifications: AppNotification[];
  loading: boolean;
  fetchNotifications: () => Promise<void>;
  addNotification: (notif: Omit<AppNotification, 'id' | 'read' | 'createdAt'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  unreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>()(
  (set, get) => ({
    notifications: [],
    loading: false,

    fetchNotifications: async () => {
      try {
        set({ loading: true });
        const data = await notificationsService.list(50);
        set({ notifications: data.notifications.map(dbToApp), loading: false });
      } catch (err) {
        console.error('Erreur chargement notifications:', err);
        set({ loading: false });
      }
    },

    addNotification: (notif) => {
      // Ajouter en temps réel (socket) — pas besoin de sauvegarder en DB, c'est déjà fait côté backend
      const newNotif: AppNotification = {
        ...notif,
        id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        read: false,
        createdAt: Date.now(),
      };
      set((state) => ({
        notifications: [newNotif, ...state.notifications].slice(0, 100),
      }));
    },

    markAsRead: (id) => {
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
      }));
      // Sync avec la DB (ignorer les notifs temps réel non persistées)
      if (!id.startsWith('rt-')) {
        notificationsService.markAsRead(id).catch(() => {});
      }
    },

    markAllAsRead: () => {
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
      }));
      notificationsService.markAllAsRead().catch(() => {});
    },

    clearAll: () => set({ notifications: [] }),

    unreadCount: () => {
      return get().notifications.filter((n) => !n.read).length;
    },
  })
);

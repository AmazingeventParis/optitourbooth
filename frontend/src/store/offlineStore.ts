import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface OfflineQueueItem {
  id: string;
  type: 'gps-position' | 'photo-upload' | 'point-completion';
  payload: Record<string, unknown>;
  retries: number;
  createdAt: number;
}

interface OfflineState {
  queue: OfflineQueueItem[];
  addToQueue: (item: Omit<OfflineQueueItem, 'id' | 'retries' | 'createdAt'>) => void;
  removeFromQueue: (id: string) => void;
  incrementRetries: (id: string) => void;
  clearQueue: () => void;
  getQueueByType: (type: OfflineQueueItem['type']) => OfflineQueueItem[];
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      queue: [],

      addToQueue: (item) => {
        const newItem: OfflineQueueItem = {
          ...item,
          id: `${item.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          retries: 0,
          createdAt: Date.now(),
        };
        set((state) => ({ queue: [...state.queue, newItem] }));
      },

      removeFromQueue: (id) => {
        set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
      },

      incrementRetries: (id) => {
        set((state) => ({
          queue: state.queue.map((item) =>
            item.id === id ? { ...item, retries: item.retries + 1 } : item
          ),
        }));
      },

      clearQueue: () => set({ queue: [] }),

      getQueueByType: (type) => {
        return get().queue.filter((item) => item.type === type);
      },
    }),
    {
      name: 'optitour-offline-queue',
    }
  )
);

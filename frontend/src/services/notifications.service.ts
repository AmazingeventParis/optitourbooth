import api, { ApiResponse } from './api';

export interface DbNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, string> | null;
  read: boolean;
  createdAt: string;
}

interface ListResponse {
  notifications: DbNotification[];
  total: number;
  unreadCount: number;
}

export const notificationsService = {
  async list(limit = 50, offset = 0): Promise<ListResponse> {
    const response = await api.get<ApiResponse<ListResponse>>(
      `/notifications?limit=${limit}&offset=${offset}`
    );
    return response.data.data;
  },

  async markAsRead(id: string): Promise<void> {
    await api.patch(`/notifications/${id}/read`);
  },

  async markAllAsRead(): Promise<void> {
    await api.patch('/notifications/mark-all-read');
  },
};

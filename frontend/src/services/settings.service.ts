import api, { ApiResponse } from './api';
import type { TenantSettings } from '@/types/settings';

export const settingsService = {
  async get(): Promise<TenantSettings> {
    const response = await api.get<ApiResponse<TenantSettings>>('/settings');
    return response.data.data;
  },

  async update(data: Partial<TenantSettings>): Promise<TenantSettings> {
    const response = await api.put<ApiResponse<TenantSettings>>('/settings', data);
    return response.data.data;
  },
};

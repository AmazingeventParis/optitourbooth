import api, { ApiResponse } from './api';
import { User } from '@/types';

interface LoginResponse {
  user: User;
  token: string;
  refreshToken: string;
}

interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
}

export const authService = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await api.post<ApiResponse<LoginResponse>>('/auth/login', {
      email,
      password,
    });
    return response.data.data;
  },

  async logout(refreshToken: string): Promise<void> {
    await api.post('/auth/logout', { refreshToken });
  },

  async getMe(): Promise<User> {
    const response = await api.get<ApiResponse<User>>('/auth/me');
    return response.data.data;
  },

  async changePassword(data: ChangePasswordData): Promise<void> {
    await api.put('/auth/password', data);
  },
};

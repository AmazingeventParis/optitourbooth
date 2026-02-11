import api, { ApiResponse } from './api';
import { User, PaginationMeta } from '@/types';

interface CreateUserData {
  email: string;
  password: string;
  nom: string;
  prenom: string;
  role: 'admin' | 'chauffeur';
  telephone?: string;
}

interface UpdateUserData {
  email?: string;
  password?: string;
  nom?: string;
  prenom?: string;
  role?: 'admin' | 'chauffeur';
  telephone?: string;
  actif?: boolean;
}

interface UsersFilters {
  page?: number;
  limit?: number;
  role?: 'admin' | 'chauffeur';
  actif?: boolean;
  search?: string;
}

export const usersService = {
  async list(filters: UsersFilters = {}): Promise<{ data: User[]; meta: PaginationMeta }> {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.role) params.append('role', filters.role);
    if (filters.actif !== undefined) params.append('actif', filters.actif.toString());
    if (filters.search) params.append('search', filters.search);

    const response = await api.get<ApiResponse<User[]>>(`/users?${params}`);
    return {
      data: response.data.data,
      meta: response.data.meta || { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  },

  async getById(id: string): Promise<User> {
    const response = await api.get<ApiResponse<User>>(`/users/${id}`);
    return response.data.data;
  },

  async create(data: CreateUserData): Promise<User> {
    const response = await api.post<ApiResponse<User>>('/users', data);
    return response.data.data;
  },

  async update(id: string, data: UpdateUserData): Promise<User> {
    const response = await api.put<ApiResponse<User>>(`/users/${id}`, data);
    return response.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/users/${id}`);
  },

  async listChauffeurs(): Promise<User[]> {
    const response = await api.get<ApiResponse<User[]>>('/users/chauffeurs');
    return response.data.data;
  },

  async uploadAvatar(userId: string, file: File): Promise<User> {
    const formData = new FormData();
    formData.append('avatar', file);
    const response = await api.post<ApiResponse<User>>(`/users/${userId}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
  },

  async deleteAvatar(userId: string): Promise<User> {
    const response = await api.delete<ApiResponse<User>>(`/users/${userId}/avatar`);
    return response.data.data;
  },
};

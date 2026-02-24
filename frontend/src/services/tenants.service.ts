import api, { ApiResponse } from './api';
import { Tenant, PaginationMeta } from '@/types';

interface CreateTenantData {
  name: string;
  slug?: string;
  plan?: 'STARTER' | 'PRO' | 'ENTERPRISE';
  active?: boolean;
}

interface UpdateTenantData {
  name?: string;
  slug?: string;
  plan?: 'STARTER' | 'PRO' | 'ENTERPRISE';
  config?: Record<string, unknown>;
  active?: boolean;
}

interface CreateTenantAdminData {
  email: string;
  password: string;
  nom: string;
  prenom: string;
  telephone?: string;
}

interface TenantsFilters {
  page?: number;
  limit?: number;
  active?: boolean;
  search?: string;
}

export const tenantsService = {
  async list(filters: TenantsFilters = {}): Promise<{ data: Tenant[]; meta: PaginationMeta }> {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.active !== undefined) params.append('active', filters.active.toString());
    if (filters.search) params.append('search', filters.search);

    const response = await api.get<ApiResponse<Tenant[]>>(`/tenants?${params}`);
    return {
      data: response.data.data,
      meta: response.data.meta || { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  },

  async getById(id: string): Promise<Tenant> {
    const response = await api.get<ApiResponse<Tenant>>(`/tenants/${id}`);
    return response.data.data;
  },

  async create(data: CreateTenantData): Promise<Tenant> {
    const response = await api.post<ApiResponse<Tenant>>('/tenants', data);
    return response.data.data;
  },

  async update(id: string, data: UpdateTenantData): Promise<Tenant> {
    const response = await api.put<ApiResponse<Tenant>>(`/tenants/${id}`, data);
    return response.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/tenants/${id}`);
  },

  async createAdmin(tenantId: string, data: CreateTenantAdminData): Promise<unknown> {
    const response = await api.post<ApiResponse<unknown>>(`/tenants/${tenantId}/admin`, data);
    return response.data.data;
  },

  async listUsers(tenantId: string, page = 1): Promise<{ data: unknown[]; meta: PaginationMeta }> {
    const response = await api.get<ApiResponse<unknown[]>>(`/tenants/${tenantId}/users?page=${page}`);
    return {
      data: response.data.data,
      meta: response.data.meta || { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  },
};

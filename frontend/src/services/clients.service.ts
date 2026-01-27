import api, { ApiResponse } from './api';
import { Client, PaginationMeta } from '@/types';

interface CreateClientData {
  nom: string;
  email?: string;
  telephone?: string;
  adresse: string;
  complementAdresse?: string;
  codePostal: string;
  ville: string;
  pays?: string;
  instructionsAcces?: string;
  contactNom?: string;
  contactTelephone?: string;
}

interface UpdateClientData extends Partial<CreateClientData> {
  actif?: boolean;
  latitude?: number;
  longitude?: number;
}

interface ClientsFilters {
  page?: number;
  limit?: number;
  actif?: boolean;
  ville?: string;
  codePostal?: string;
  search?: string;
}

export const clientsService = {
  async list(filters: ClientsFilters = {}): Promise<{ data: Client[]; meta: PaginationMeta }> {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.actif !== undefined) params.append('actif', filters.actif.toString());
    if (filters.ville) params.append('ville', filters.ville);
    if (filters.codePostal) params.append('codePostal', filters.codePostal);
    if (filters.search) params.append('search', filters.search);

    const response = await api.get<ApiResponse<Client[]>>(`/clients?${params}`);
    return {
      data: response.data.data,
      meta: response.data.meta || { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  },

  async getById(id: string): Promise<Client> {
    const response = await api.get<ApiResponse<Client>>(`/clients/${id}`);
    return response.data.data;
  },

  async create(data: CreateClientData): Promise<Client> {
    const response = await api.post<ApiResponse<Client>>('/clients', data);
    return response.data.data;
  },

  async update(id: string, data: UpdateClientData): Promise<Client> {
    const response = await api.put<ApiResponse<Client>>(`/clients/${id}`, data);
    return response.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/clients/${id}`);
  },

  async search(q: string): Promise<Client[]> {
    const response = await api.get<ApiResponse<Client[]>>(`/clients/search?q=${encodeURIComponent(q)}`);
    return response.data.data;
  },

  async listVilles(): Promise<string[]> {
    const response = await api.get<ApiResponse<string[]>>('/clients/villes');
    return response.data.data;
  },

  async geocode(id: string): Promise<Client> {
    const response = await api.post<ApiResponse<Client>>(`/clients/${id}/geocode`);
    return response.data.data;
  },
};

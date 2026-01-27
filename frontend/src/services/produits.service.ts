import api, { ApiResponse } from './api';
import { Produit, PaginationMeta } from '@/types';

interface ProduitOption {
  id: string;
  nom: string;
  description?: string;
  dureeSupp: number;
  actif: boolean;
}

interface ProduitWithOptions extends Produit {
  options: ProduitOption[];
}

interface CreateProduitData {
  nom: string;
  couleur?: string;
  dureeInstallation?: number;
  dureeDesinstallation?: number;
  poids?: number;
  largeur?: number;
  hauteur?: number;
  profondeur?: number;
}

interface UpdateProduitData extends Partial<CreateProduitData> {
  actif?: boolean;
}

interface CreateOptionData {
  nom: string;
  description?: string;
  dureeSupp?: number;
}

interface UpdateOptionData extends Partial<CreateOptionData> {
  actif?: boolean;
}

interface ProduitsFilters {
  page?: number;
  limit?: number;
  actif?: boolean;
  search?: string;
}

export const produitsService = {
  async list(filters: ProduitsFilters = {}): Promise<{ data: ProduitWithOptions[]; meta: PaginationMeta }> {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.actif !== undefined) params.append('actif', filters.actif.toString());
    if (filters.search) params.append('search', filters.search);

    const response = await api.get<ApiResponse<ProduitWithOptions[]>>(`/produits?${params}`);
    return {
      data: response.data.data,
      meta: response.data.meta || { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  },

  async getById(id: string): Promise<ProduitWithOptions> {
    const response = await api.get<ApiResponse<ProduitWithOptions>>(`/produits/${id}`);
    return response.data.data;
  },

  async create(data: CreateProduitData): Promise<ProduitWithOptions> {
    const response = await api.post<ApiResponse<ProduitWithOptions>>('/produits', data);
    return response.data.data;
  },

  async update(id: string, data: UpdateProduitData): Promise<ProduitWithOptions> {
    const response = await api.put<ApiResponse<ProduitWithOptions>>(`/produits/${id}`, data);
    return response.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/produits/${id}`);
  },

  async listActifs(): Promise<ProduitWithOptions[]> {
    const response = await api.get<ApiResponse<ProduitWithOptions[]>>('/produits/actifs');
    return response.data.data;
  },

  // Options
  async createOption(produitId: string, data: CreateOptionData): Promise<ProduitOption> {
    const response = await api.post<ApiResponse<ProduitOption>>(`/produits/${produitId}/options`, data);
    return response.data.data;
  },

  async updateOption(produitId: string, optionId: string, data: UpdateOptionData): Promise<ProduitOption> {
    const response = await api.put<ApiResponse<ProduitOption>>(`/produits/${produitId}/options/${optionId}`, data);
    return response.data.data;
  },

  async deleteOption(produitId: string, optionId: string): Promise<void> {
    await api.delete(`/produits/${produitId}/options/${optionId}`);
  },
};

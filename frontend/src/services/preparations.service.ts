import api from './api';
import { Preparation, PreparationStatut } from '../types';

interface PreparationListResponse {
  data: Preparation[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface CreatePreparationData {
  machineId: string;
  dateEvenement: string;
  client: string;
  preparateur: string;
  notes?: string;
}

interface UpdatePreparationData {
  statut?: PreparationStatut;
  photosDechargees?: boolean;
  notes?: string;
  dateEvenement?: string;
  client?: string;
  preparateur?: string;
}

export const preparationsService = {
  /**
   * Liste toutes les préparations
   */
  async list(filters?: {
    statut?: PreparationStatut;
    machineId?: string;
    client?: string;
    archived?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PreparationListResponse> {
    const params = new URLSearchParams();
    if (filters?.statut) params.append('statut', filters.statut);
    if (filters?.machineId) params.append('machineId', filters.machineId);
    if (filters?.client) params.append('client', filters.client);
    if (filters?.archived !== undefined) params.append('archived', filters.archived.toString());
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const { data } = await api.get<PreparationListResponse>(`/preparations?${params}`);
    return data;
  },

  /**
   * Récupère une préparation par ID
   */
  async getById(id: string): Promise<Preparation> {
    const { data } = await api.get<Preparation>(`/preparations/${id}`);
    return data;
  },

  /**
   * Crée une nouvelle préparation
   */
  async create(preparationData: CreatePreparationData): Promise<Preparation> {
    const { data } = await api.post<Preparation>('/preparations', preparationData);
    return data;
  },

  /**
   * Met à jour une préparation
   */
  async update(id: string, updateData: UpdatePreparationData): Promise<Preparation> {
    const { data } = await api.patch<Preparation>(`/preparations/${id}`, updateData);
    return data;
  },

  /**
   * Supprime une préparation
   */
  async delete(id: string): Promise<void> {
    await api.delete(`/preparations/${id}`);
  },

  /**
   * Marque une préparation comme prête
   */
  async markAsReady(id: string): Promise<Preparation> {
    const { data } = await api.post<Preparation>(`/preparations/${id}/ready`);
    return data;
  },

  /**
   * Marque les photos comme déchargées et archive
   */
  async markPhotosUnloaded(id: string): Promise<Preparation> {
    const { data} = await api.post<Preparation>(`/preparations/${id}/unload-photos`);
    return data;
  },
};

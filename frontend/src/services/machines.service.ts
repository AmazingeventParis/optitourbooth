import api from './api';
import { Machine, MachineType } from '../types';

export const machinesService = {
  /**
   * Liste toutes les machines
   */
  async list(filters?: { type?: MachineType; actif?: boolean }): Promise<Machine[]> {
    const params = new URLSearchParams();
    if (filters?.type) params.append('type', filters.type);
    if (filters?.actif !== undefined) params.append('actif', filters.actif.toString());

    const { data } = await api.get<Machine[]>(`/machines?${params}`);
    return data;
  },

  /**
   * Récupère une machine par ID
   */
  async getById(id: string): Promise<Machine> {
    const { data } = await api.get<Machine>(`/machines/${id}`);
    return data;
  },

  /**
   * Upload une image pour un type de machine
   */
  async uploadImage(type: MachineType, file: File): Promise<{ imageUrl: string; updatedCount: number; message: string }> {
    const formData = new FormData();
    formData.append('image', file);

    const { data } = await api.post(`/machines/type/${type}/image`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },
};

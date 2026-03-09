import api, { ApiResponse } from './api';

export interface BackendPendingPoint {
  id: string;
  date: string;
  clientName: string;
  adresse?: string;
  type: string;
  produitNom?: string;
  creneauDebut?: string;
  creneauFin?: string;
  notes?: string;
  contactNom?: string;
  contactTelephone?: string;
  source: string;
  externalId?: string;
}

export const pendingPointsService = {
  async listByDate(date: string): Promise<BackendPendingPoint[]> {
    const response = await api.get<ApiResponse<BackendPendingPoint[]>>(
      `/pending-points?date=${date}`
    );
    return response.data.data;
  },

  async markDispatched(id: string): Promise<void> {
    await api.patch(`/pending-points/${id}/dispatch`);
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/pending-points/${id}`);
  },
};

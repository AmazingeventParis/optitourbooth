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
  quantiteBornes?: number;
  attachments?: Array<{ fileId: string | null; title: string; mimeType: string; iconLink: string | null; fileUrl: string | null }>;
}

export interface CalendarEvent {
  id: string;
  date: string;
  clientName: string;
  eventName?: string | null;
  produitNom?: string;
  adresse?: string;
  externalId?: string;
  suggestedMachineId?: string | null;
}

export const pendingPointsService = {
  async listByDate(date: string): Promise<BackendPendingPoint[]> {
    const response = await api.get<ApiResponse<BackendPendingPoint[]>>(
      `/pending-points?date=${date}`
    );
    return response.data.data;
  },

  // Événements de préparation fusionnés des deux CRM (Shootnbox + Smakk),
  // lus en direct depuis la readiness. Le filtrage par type de borne se fait
  // côté frontend via `produitNom` (colonne "Borne").
  async listCalendarEvents(): Promise<CalendarEvent[]> {
    const response = await api.get<ApiResponse<CalendarEvent[]>>(
      `/pending-points/calendar-events`
    );
    return response.data.data;
  },

  async update(id: string, data: Partial<Omit<BackendPendingPoint, 'id' | 'source' | 'externalId'>>): Promise<BackendPendingPoint> {
    const response = await api.patch<ApiResponse<BackendPendingPoint>>(`/pending-points/${id}`, data);
    return response.data.data;
  },

  async markUsedInPreparation(id: string): Promise<void> {
    await api.patch(`/pending-points/${id}/use-in-preparation`);
  },

  async createManual(data: {
    date: string;
    clientName: string;
    type: string;
    adresse?: string;
    produitNom?: string;
    creneauDebut?: string;
    creneauFin?: string;
    notes?: string;
    contactNom?: string;
    contactTelephone?: string;
  }): Promise<BackendPendingPoint> {
    const response = await api.post<ApiResponse<BackendPendingPoint>>('/pending-points/manual', data);
    return response.data.data;
  },

  async ignoreSuggestion(id: string): Promise<void> {
    await api.patch(`/pending-points/${id}/ignore-suggestion`);
  },

  async restoreSuggestion(id: string): Promise<void> {
    await api.patch(`/pending-points/${id}/restore-suggestion`);
  },

  async markDispatched(id: string): Promise<void> {
    await api.patch(`/pending-points/${id}/dispatch`);
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/pending-points/${id}`);
  },

  async syncCrm(): Promise<{ created: number; enriched: number; skipped: number; errors: string[] }> {
    const response = await api.post<ApiResponse<{ created: number; enriched: number; skipped: number; errors: string[] }>>(
      '/pending-points/sync-crm',
      {},
      { timeout: 90000 },
    );
    return response.data.data;
  },

  async getSyncStatus(): Promise<{ errors: string[]; completedAt?: string } | null> {
    const response = await api.get<ApiResponse<{ errors: string[]; completedAt?: string } | null>>(
      '/pending-points/sync-status',
    );
    return response.data.data;
  },
};

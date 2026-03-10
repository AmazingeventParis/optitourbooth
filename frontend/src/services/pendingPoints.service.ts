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

export interface CalendarEvent {
  id: string;
  date: string;
  clientName: string;
  produitNom?: string;
  adresse?: string;
  externalId?: string;
}

export const pendingPointsService = {
  async listByDate(date: string): Promise<BackendPendingPoint[]> {
    const response = await api.get<ApiResponse<BackendPendingPoint[]>>(
      `/pending-points?date=${date}`
    );
    return response.data.data;
  },

  async listCalendarEvents(calendarType: 'shootnbox' | 'smakk'): Promise<CalendarEvent[]> {
    const response = await api.get<ApiResponse<CalendarEvent[]>>(
      `/pending-points/calendar-events?calendarType=${calendarType}`
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

  async markDispatched(id: string): Promise<void> {
    await api.patch(`/pending-points/${id}/dispatch`);
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/pending-points/${id}`);
  },
};

import api, { ApiResponse } from './api';
import { Tournee, Point, PaginationMeta } from '@/types';

interface TourneesFilters {
  page?: number;
  limit?: number;
  date?: string;
  dateDebut?: string;
  dateFin?: string;
  chauffeurId?: string;
  statut?: string;
  includePoints?: boolean;
}

interface CreateTourneeData {
  date: string;
  chauffeurId: string;
  vehiculeId?: string;
  heureDepart?: string;
  depotAdresse?: string;
  depotLatitude?: number;
  depotLongitude?: number;
  notes?: string;
}

interface UpdateTourneeData {
  date?: string;
  chauffeurId?: string;
  vehiculeId?: string | null;
  statut?: string;
  heureDepart?: string;
  heureFinEstimee?: string;
  depotAdresse?: string;
  depotLatitude?: number;
  depotLongitude?: number;
  notes?: string;
}

interface CreatePointData {
  clientId: string;
  type: 'livraison' | 'ramassage' | 'livraison_ramassage';
  creneauDebut?: string;
  creneauFin?: string;
  dureePrevue?: number;
  notesInternes?: string;
  notesClient?: string;
  produits?: Array<{ produitId: string; quantite: number }>;
}

interface UpdatePointData {
  type?: 'livraison' | 'ramassage' | 'livraison_ramassage';
  statut?: string;
  creneauDebut?: string;
  creneauFin?: string;
  dureePrevue?: number;
  notesInternes?: string;
  notesClient?: string;
  signatureData?: string;
  signatureNom?: string;
  produits?: { produitId: string; quantite: number }[];
}

interface CreateIncidentData {
  type: 'client_absent' | 'adresse_incorrecte' | 'acces_impossible' | 'materiel_endommage' | 'retard_important' | 'autre';
  description: string;
  photosUrls?: string[];
}

interface TourneeStats {
  distanceTotaleKm: number;
  dureeTotaleMin: number;
  nombrePoints: number;
  heureFinEstimee: string;
}

interface OptimizeResult {
  tournee: Tournee;
  stats: TourneeStats;
  improvements: {
    distanceSaved: number;
    timeSaved: number;
  };
}

export interface ImportParsedPoint {
  clientName: string;
  societe?: string;
  adresse?: string;
  produitName?: string;
  produitCouleur?: string;
  type: string;
  creneauDebut?: string;
  creneauFin?: string;
  contactNom?: string;
  contactTelephone?: string;
  notes?: string;
  clientId?: string;
  produitId?: string;
  produitsIds?: { id: string; nom: string }[];
  clientFound: boolean;
  produitFound: boolean;
  errors: string[];
}

export interface ImportResult {
  success: boolean;
  totalRows: number;
  imported: number;
  errors: Array<{ row: number; message: string }>;
  points: ImportParsedPoint[];
}

export const tourneesService = {
  async list(filters: TourneesFilters = {}): Promise<{ data: Tournee[]; meta: PaginationMeta }> {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.date) params.append('date', filters.date);
    if (filters.dateDebut) params.append('dateDebut', filters.dateDebut);
    if (filters.dateFin) params.append('dateFin', filters.dateFin);
    if (filters.chauffeurId) params.append('chauffeurId', filters.chauffeurId);
    if (filters.statut) params.append('statut', filters.statut);
    if (filters.includePoints) params.append('includePoints', 'true');

    const response = await api.get<ApiResponse<Tournee[]>>(`/tournees?${params}`);
    return {
      data: response.data.data,
      meta: response.data.meta || { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  },

  async getById(id: string, light = false): Promise<Tournee> {
    const response = await api.get<ApiResponse<Tournee>>(`/tournees/${id}${light ? '?light=true' : ''}`);
    return response.data.data;
  },

  async create(data: CreateTourneeData): Promise<Tournee> {
    const response = await api.post<ApiResponse<Tournee>>('/tournees', data);
    return response.data.data;
  },

  async update(id: string, data: UpdateTourneeData): Promise<Tournee> {
    const response = await api.put<ApiResponse<Tournee>>(`/tournees/${id}`, data);
    return response.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/tournees/${id}`);
  },

  async duplicate(id: string, newDate: string): Promise<Tournee> {
    const response = await api.post<ApiResponse<Tournee>>(`/tournees/${id}/duplicate`, { newDate });
    return response.data.data;
  },

  // Points - Les endpoints retournent maintenant la tournée complète avec ETAs calculées
  async addPoint(tourneeId: string, data: CreatePointData): Promise<Tournee> {
    const response = await api.post<ApiResponse<Tournee>>(`/tournees/${tourneeId}/points`, data);
    return response.data.data;
  },

  async updatePoint(tourneeId: string, pointId: string, data: UpdatePointData): Promise<Point> {
    const response = await api.put<ApiResponse<Point>>(`/tournees/${tourneeId}/points/${pointId}`, data);
    return response.data.data;
  },

  async deletePoint(tourneeId: string, pointId: string): Promise<Tournee> {
    const response = await api.delete<ApiResponse<Tournee>>(`/tournees/${tourneeId}/points/${pointId}`);
    return response.data.data;
  },

  async reorderPoints(tourneeId: string, pointIds: string[]): Promise<Tournee> {
    const response = await api.put<ApiResponse<Tournee>>(`/tournees/${tourneeId}/points/reorder`, { pointIds });
    return response.data.data;
  },

  async movePoint(sourceTourneeId: string, pointId: string, targetTourneeId: string, ordre?: number): Promise<{ sourceTournee: Tournee; targetTournee: Tournee }> {
    const response = await api.put<ApiResponse<{ sourceTournee: Tournee; targetTournee: Tournee }>>(
      `/tournees/${sourceTourneeId}/points/${pointId}/move`,
      { targetTourneeId, ordre }
    );
    return response.data.data;
  },

  // Optimization
  async optimize(id: string): Promise<OptimizeResult> {
    const response = await api.post<ApiResponse<OptimizeResult>>(`/tournees/${id}/optimize`);
    return response.data.data;
  },

  async calculateStats(id: string): Promise<TourneeStats> {
    const response = await api.get<ApiResponse<TourneeStats>>(`/tournees/${id}/stats`);
    return response.data.data;
  },

  // Status changes
  async start(id: string): Promise<Tournee> {
    const response = await api.post<ApiResponse<Tournee>>(`/tournees/${id}/start`);
    return response.data.data;
  },

  async finish(id: string): Promise<Tournee> {
    const response = await api.post<ApiResponse<Tournee>>(`/tournees/${id}/finish`);
    return response.data.data;
  },

  async cancel(id: string): Promise<Tournee> {
    const response = await api.post<ApiResponse<Tournee>>(`/tournees/${id}/cancel`);
    return response.data.data;
  },

  // Import Excel
  async importPreviewGeneral(file: File): Promise<{ points: ImportParsedPoint[] }> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post<ApiResponse<{ points: ImportParsedPoint[] }>>(
      `/tournees/import/preview`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data.data;
  },

  async importPreview(tourneeId: string, file: File): Promise<{ points: ImportParsedPoint[] }> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post<ApiResponse<{ points: ImportParsedPoint[] }>>(
      `/tournees/${tourneeId}/import/preview`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data.data;
  },

  async importPoints(tourneeId: string, file: File): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post<ApiResponse<ImportResult>>(
      `/tournees/${tourneeId}/import`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data.data;
  },

  // Photos - Chauffeur
  async uploadPhotos(tourneeId: string, pointId: string, files: File[]): Promise<unknown[]> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('photos', file);
    });

    const response = await api.post<ApiResponse<unknown[]>>(
      `/tournees/${tourneeId}/points/${pointId}/photos`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data.data;
  },

  // Incidents - Chauffeur
  async createIncident(tourneeId: string, pointId: string, data: CreateIncidentData): Promise<unknown> {
    const response = await api.post<ApiResponse<unknown>>(
      `/tournees/${tourneeId}/points/${pointId}/incidents`,
      data
    );
    return response.data.data;
  },

  // Auto-dispatch des points en attente
  async autoDispatch(date: string, pendingPoints: Array<{
    clientId: string;
    clientName: string;
    type: string;
    creneauDebut?: string;
    creneauFin?: string;
    produitIds?: string[];
    latitude?: number;
    longitude?: number;
    notes?: string;
    contactNom?: string;
    contactTelephone?: string;
  }>): Promise<{
    success: boolean;
    totalDispatched: number;
    totalFailed: number;
    dispatched: Array<{
      pointIndex: number;
      clientName: string;
      assignedTourneeId: string;
      chauffeurNom: string;
      reason: string;
    }>;
    failed: Array<{
      pointIndex: number;
      clientName: string;
      reason: string;
    }>;
    updatedTournees: Tournee[];
  }> {
    const response = await api.post<ApiResponse<{
      success: boolean;
      totalDispatched: number;
      totalFailed: number;
      dispatched: Array<{
        pointIndex: number;
        clientName: string;
        assignedTourneeId: string;
        chauffeurNom: string;
        reason: string;
      }>;
      failed: Array<{
        pointIndex: number;
        clientName: string;
        reason: string;
      }>;
      updatedTournees: Tournee[];
    }>>('/tournees/auto-dispatch', { date, pendingPoints });
    return response.data.data;
  },
};

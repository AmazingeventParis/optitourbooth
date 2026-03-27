import api, { ApiResponse } from './api';

export interface CustomItem {
  name: string;
  price: number;
}

export interface BillingConfigData {
  tarifPointHorsForfait: number;
  tarifHeureSupp: number;
  horsForfaitDebut: string;
  horsForfaitFin: string;
  recuperationDebut: string | null;
  recuperationFin: string | null;
  isIndependent?: boolean;
  customItems: CustomItem[];
}

export interface UserBillingConfig {
  userId: string;
  nom: string;
  prenom: string;
  roles: string[];
  couleur: string | null;
  config: BillingConfigData & { id?: string };
}

export interface BillingEntry {
  id: string;
  userId: string;
  tourneeId: string | null;
  pointId: string | null;
  date: string;
  type: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  paidAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user?: { id: string; nom: string; prenom: string; couleur: string | null } | null;
}

export const billingService = {
  async getConfigs(): Promise<UserBillingConfig[]> {
    const res = await api.get<ApiResponse<UserBillingConfig[]>>('/billing/configs');
    return res.data.data;
  },

  async upsertConfig(userId: string, data: BillingConfigData): Promise<BillingConfigData> {
    const res = await api.put<ApiResponse<BillingConfigData>>(`/billing/configs/${userId}`, data);
    return res.data.data;
  },

  async getEntries(params: {
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: BillingEntry[]; meta: { page: number; limit: number; total: number; totalPages: number; totalSum: number; totalCharges: number; totalPayments: number } }> {
    const res = await api.get<ApiResponse<BillingEntry[]>>('/billing/entries', { params });
    return { data: res.data.data, meta: res.data.meta as any };
  },

  async createEntry(data: {
    userId: string;
    date: string;
    type?: string;
    label: string;
    quantity?: number;
    unitPrice: number;
    tourneeId?: string;
    pointId?: string;
  }): Promise<BillingEntry> {
    const res = await api.post<ApiResponse<BillingEntry>>('/billing/entries', data);
    return res.data.data;
  },

  async togglePaid(id: string): Promise<BillingEntry> {
    const res = await api.patch<ApiResponse<BillingEntry>>(`/billing/entries/${id}/paid`);
    return res.data.data;
  },

  async deleteEntry(id: string): Promise<void> {
    await api.delete(`/billing/entries/${id}`);
  },

  async computeEntries(dateFrom: string, dateTo: string, userId?: string): Promise<{ created: number; message: string }> {
    const res = await api.post<ApiResponse<{ created: number; message: string }>>('/billing/compute', { dateFrom, dateTo, userId });
    return res.data.data;
  },

  async getEntriesByPoints(pointIds: string[]): Promise<Record<string, { id: string; label: string; quantity: number; unitPrice: number; totalPrice: number }>> {
    if (pointIds.length === 0) return {};
    const res = await api.get<ApiResponse<Record<string, { id: string; label: string; quantity: number; unitPrice: number; totalPrice: number }>>>('/billing/entries/by-points', {
      params: { pointIds: pointIds.join(',') },
    });
    return res.data.data;
  },

  async upsertPointHfEntry(pointId: string, data: {
    quantity: number;
    unitPrice: number;
    tourneeId: string;
    userId: string;
    date: string;
    clientName: string;
    label?: string;
  }): Promise<BillingEntry> {
    const res = await api.put<ApiResponse<BillingEntry>>(`/billing/entries/point-hf/${pointId}`, data);
    return res.data.data;
  },

  async deletePointHfEntry(pointId: string): Promise<void> {
    await api.delete(`/billing/entries/point-hf/${pointId}`);
  },

  async getRecoveryEntries(params: {
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: BillingEntry[]; meta: { page: number; limit: number; total: number; totalPages: number; totalCredite: number; totalSolde: number; balance: number } }> {
    const res = await api.get<ApiResponse<BillingEntry[]>>('/billing/recovery', { params });
    return { data: res.data.data, meta: res.data.meta as any };
  },

  async createRecoverySolde(data: {
    userId: string;
    date: string;
    hours: number;
    label?: string;
  }): Promise<BillingEntry> {
    const res = await api.post<ApiResponse<BillingEntry>>('/billing/recovery/solde', data);
    return res.data.data;
  },
};

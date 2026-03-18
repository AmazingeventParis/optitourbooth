import api, { ApiResponse } from './api';

export interface AllocationBlock {
  id: string;
  client: string;
  produit: string;
  produitCouleur: string;
  dateStart: string;
  timeStart: string;
  dateEnd: string;
  timeEnd: string;
  deliveryPointId: string;
  pickupPointId: string | null;
  machineNumero: string | null;
  machineType: string | null;
  status: 'planifie' | 'immobilisee' | 'livree';
  source: 'tournee' | 'pending' | 'preparation';
}

export interface StockDay {
  date: string;
  availability: Record<string, {
    total: number;
    occupied: number;
    horsService: number;
    available: number;
  }>;
}

export interface StockData {
  totalByType: Record<string, number>;
  horsServiceByType: Record<string, number>;
  days: StockDay[];
}

export interface AgendaMachine {
  id: string;
  type: string;
  numero: string;
  couleur: string;
  aDefaut: boolean;
  defaut?: string;
}

export const agendaService = {
  async getAllocations(dateFrom: string, dateTo: string): Promise<AllocationBlock[]> {
    const res = await api.get<ApiResponse<AllocationBlock[]>>('/agenda/allocations', {
      params: { dateFrom, dateTo },
    });
    return res.data.data;
  },

  async getStock(dateFrom: string, dateTo: string): Promise<StockData> {
    const res = await api.get<ApiResponse<StockData>>('/agenda/stock', {
      params: { dateFrom, dateTo },
    });
    return res.data.data;
  },

  async getMachines(): Promise<Record<string, AgendaMachine[]>> {
    const res = await api.get<ApiResponse<Record<string, AgendaMachine[]>>>('/agenda/machines');
    return res.data.data;
  },
};

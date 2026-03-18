import api, { ApiResponse } from './api';

export interface AllocationBlock {
  id: string;
  machineId: string;
  machineType: string;
  machineNumero: string;
  machineCouleur: string;
  client: string;
  status: string;
  dateStart: string;
  timeStart: string;
  dateEnd: string;
  timeEnd: string;
  preparationId: string;
  deliveryPointId: string | null;
  pickupPointId: string | null;
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

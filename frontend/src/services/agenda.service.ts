import api, { ApiResponse } from './api';

export interface AllocationBlock {
  id: string;
  client: string;
  clientAdresse: string | null;
  clientVille: string | null;
  clientTelephone: string | null;
  clientContactNom: string | null;
  produit: string;
  produitCouleur: string;
  dateStart: string;
  timeStart: string;
  dateEnd: string;
  timeEnd: string;
  machineNumero: string | null;
  machineType: string | null;
  status: 'planifie' | 'immobilisee' | 'livree';
  source: 'tournee' | 'pending' | 'preparation';
  tourneeId: string | null;
  deliveryPointId: string | null;
  pickupPointId: string | null;
  notesInternes: string | null;
  preparateurNom: string | null;
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
  horsService: boolean;
  suggestionsCount: number;
  validatedCount: number;
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

  async getMachines(dateFrom?: string, dateTo?: string): Promise<Record<string, AgendaMachine[]>> {
    const params: Record<string, string> = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    const res = await api.get<ApiResponse<Record<string, AgendaMachine[]>>>('/agenda/machines', { params });
    return res.data.data;
  },

  async assignMachine(data: { blockId: string; targetMachineId: string; client: string; dateEvenement: string }): Promise<any> {
    const res = await api.post<ApiResponse<any>>('/agenda/assign-machine', data);
    return res.data.data;
  },

  async optimize(dateFrom: string, dateTo: string): Promise<{ assigned: number; skipped: number; message: string }> {
    const res = await api.post<ApiResponse<{ assigned: number; skipped: number; message: string }>>('/agenda/optimize', { dateFrom, dateTo });
    return res.data.data;
  },

  async checkMargin(data: { targetMachineId: string; dateStart: string; timeStart: string; dateEnd: string; timeEnd: string; dateFrom?: string; dateTo?: string; blockClient?: string }): Promise<{ ok: boolean; warnings: string[] }> {
    const res = await api.post<ApiResponse<{ ok: boolean; warnings: string[] }>>('/agenda/check-margin', data);
    return res.data.data;
  },

  async validateMachine(machineId: string, blocks: Array<{ client: string; dateStart: string }>, dateFrom: string, dateTo: string): Promise<{ suggested: number; machine: string; message: string }> {
    const res = await api.post<ApiResponse<{ suggested: number; machine: string; message: string }>>('/agenda/validate-machine', { machineId, blocks, dateFrom, dateTo });
    return res.data.data;
  },

  async validateType(machineType: string, machineBlocks: Array<{ machineId: string; blocks: Array<{ client: string; dateStart: string }> }>, dateFrom: string, dateTo: string): Promise<{ suggested: number; machines: number; message: string }> {
    const res = await api.post<ApiResponse<{ suggested: number; machines: number; message: string }>>('/agenda/validate-type', { machineType, machineBlocks, dateFrom, dateTo });
    return res.data.data;
  },

  async unlockMachine(machineId: string, dateFrom: string, dateTo: string): Promise<{ cleared: number; message: string }> {
    const res = await api.post<ApiResponse<{ cleared: number; message: string }>>('/agenda/unlock-machine', { machineId, dateFrom, dateTo });
    return res.data.data;
  },
};

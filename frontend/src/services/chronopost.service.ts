import api from './api';

export type ChronopostStatut = 'en_preparation' | 'expedie' | 'livre' | 'en_retour' | 'rentre' | 'probleme';

export interface ChronopostExpedition {
  id: string;
  numeroColis: string;
  clientNom: string;
  clientAdresse?: string;
  clientVille?: string;
  produitNom?: string;
  notes?: string;
  dateDepart?: string;
  dateLivraisonPrevue?: string;
  dateLivraisonReelle?: string;
  dateRetourPrevu?: string;
  dateRetourReel?: string;
  numeroColisRetour?: string;
  statut: ChronopostStatut;
  trackingData?: {
    events: Array<{ code: string; libelle: string; date: string; site: string; dest?: string }>;
    statusInfo?: string;
    errorCode?: string;
    errorMessage?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const chronopostService = {
  async list(): Promise<ChronopostExpedition[]> {
    const res = await api.get('/chronopost');
    return res.data.data;
  },
  async create(data: { numeroColis: string; produitNom?: string; dateRetourPrevu?: string; notes?: string }): Promise<ChronopostExpedition> {
    const res = await api.post('/chronopost', data);
    return res.data.data;
  },
  async update(id: string, data: Partial<ChronopostExpedition>): Promise<ChronopostExpedition> {
    const res = await api.patch(`/chronopost/${id}`, data);
    return res.data.data;
  },
  async delete(id: string): Promise<void> {
    await api.delete(`/chronopost/${id}`);
  },
  async sync(id: string): Promise<ChronopostExpedition> {
    const res = await api.post(`/chronopost/${id}/sync`);
    return res.data.data;
  },
  async markReturned(id: string): Promise<ChronopostExpedition> {
    const res = await api.post(`/chronopost/${id}/return`);
    return res.data.data;
  },
};

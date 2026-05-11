import api from './api';

export type ChronopostStatut = 'en_preparation' | 'expedie' | 'livre' | 'en_retour' | 'rentre' | 'probleme';

export interface ChronopostSignificantEvent {
  code: string;
  eventDate: string;
  eventLabel: string;
  officeLabel?: string;
  zipCode?: string;
}

export interface ChronopostTrackingEvent {
  code: string;
  libelle: string;
  date: string;
  site: string;
  dest?: string;
}

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
    significantEvent?: ChronopostSignificantEvent;
    events?: ChronopostTrackingEvent[];
    errorCode?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const chronopostService = {
  async list(): Promise<ChronopostExpedition[]> {
    const res = await api.get('/chronopost');
    return res.data.data;
  },

  async syncAccount(dateDebut?: string, dateFin?: string): Promise<{
    message: string;
    total: number;
    created: number;
    updated: number;
    expeditions: ChronopostExpedition[];
  }> {
    const res = await api.post('/chronopost/sync-account', { dateDebut, dateFin });
    return res.data.data;
  },

  async update(id: string, data: Partial<ChronopostExpedition>): Promise<ChronopostExpedition> {
    const res = await api.patch(`/chronopost/${id}`, data);
    return res.data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/chronopost/${id}`);
  },

  async syncOne(id: string): Promise<ChronopostExpedition> {
    const res = await api.post(`/chronopost/${id}/sync`);
    return res.data.data;
  },

  async markReturned(id: string): Promise<ChronopostExpedition> {
    const res = await api.post(`/chronopost/${id}/return`);
    return res.data.data;
  },
};

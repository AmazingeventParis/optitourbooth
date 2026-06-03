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
  numeroColis: string | null;
  externalId?: string | null;
  source?: string | null;
  clientNom: string;
  clientAdresse?: string;
  clientVille?: string;
  produitNom?: string;
  contactNom?: string | null;
  contactTelephone?: string | null;
  modeRetour?: string | null;
  notes?: string;
  dateEvenement?: string;
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

  async add(numeroColis: string, clientNom?: string): Promise<ChronopostExpedition> {
    const res = await api.post('/chronopost/add', { numeroColis, clientNom });
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

  async getSessionStatus(): Promise<{ configured: boolean; updatedAt: string | null }> {
    const res = await api.get('/chronopost/session');
    return res.data.data;
  },

  async updateSession(cookies: string): Promise<void> {
    await api.post('/chronopost/session', { cookies });
  },

  async syncAll(): Promise<ChronopostExpedition[]> {
    const res = await api.post('/chronopost/sync-all');
    return res.data.data;
  },
};

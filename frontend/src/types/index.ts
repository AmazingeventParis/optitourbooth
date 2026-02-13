// Types pour les entités

export type UserRole = 'admin' | 'chauffeur';
export type TourneeStatut = 'brouillon' | 'planifiee' | 'en_cours' | 'terminee' | 'annulee';
export type PointType = 'livraison' | 'ramassage' | 'livraison_ramassage';
export type PointStatut = 'a_faire' | 'en_cours' | 'termine' | 'incident' | 'annule';
export type IncidentType = 'client_absent' | 'adresse_incorrecte' | 'acces_impossible' | 'materiel_endommage' | 'retard_important' | 'autre';
export type IncidentStatut = 'ouvert' | 'en_cours' | 'resolu' | 'ferme';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  nom: string;
  prenom: string;
  telephone?: string;
  couleur?: string;
  avatarUrl?: string;
  actif: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicule {
  id: string;
  nom: string;
  marque?: string;
  modele?: string;
  immatriculation: string;
  consommationL100km?: number;
  capaciteKg?: number;
  capaciteM3?: number;
  actif: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tournees: number;
  };
}

export interface Client {
  id: string;
  nom: string;
  societe?: string;
  email?: string;
  telephone?: string;
  adresse: string;
  complementAdresse?: string;
  codePostal: string;
  ville: string;
  pays: string;
  latitude?: number;
  longitude?: number;
  instructionsAcces?: string;
  contactNom?: string;
  contactTelephone?: string;
  actif: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Produit {
  id: string;
  nom: string;
  couleur?: string;
  dureeInstallation: number;
  dureeDesinstallation: number;
  poids?: number;
  largeur?: number;
  hauteur?: number;
  profondeur?: number;
  actif: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tournee {
  id: string;
  date: string;
  chauffeurId: string;
  chauffeur?: User;
  vehiculeId?: string;
  vehicule?: Vehicule;
  statut: TourneeStatut;
  heureDepart?: string;
  heureFinEstimee?: string;
  heureFinReelle?: string;
  distanceTotaleKm?: number;
  dureeTotaleMin?: number;      // Durée totale (trajets + temps sur place + attentes)
  dureeTrajetMin?: number;       // Durée uniquement de trajet (temps de route)
  nombrePoints: number;
  depotAdresse?: string;
  depotLatitude?: number;
  depotLongitude?: number;
  notes?: string;
  points?: Point[];
  _count?: { points: number };
  createdAt: string;
  updatedAt: string;
}

export interface Point {
  id: string;
  tourneeId: string;
  tournee?: Tournee;
  clientId: string;
  client?: Client;
  type: PointType;
  ordre: number;
  statut: PointStatut;
  creneauDebut?: string;
  creneauFin?: string;
  heureArriveeEstimee?: string;
  heureArriveeReelle?: string;
  heureDepartReelle?: string;
  dureePrevue: number;
  signatureData?: string;
  signatureNom?: string;
  signatureDate?: string;
  notesInternes?: string;
  notesClient?: string;
  produits?: PointProduit[];
  photos?: Photo[];
  incidents?: Incident[];
  createdAt: string;
  updatedAt: string;
}

export interface PointProduit {
  id: string;
  pointId: string;
  produitId: string;
  produit?: Produit;
  quantite: number;
}

export interface Photo {
  id: string;
  pointId: string;
  filename: string;
  path: string;
  mimetype: string;
  size: number;
  latitude?: number;
  longitude?: number;
  takenAt: string;
  type: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  pointId: string;
  type: IncidentType;
  statut: IncidentStatut;
  description: string;
  resolution?: string;
  photosUrls: string[];
  dateDeclaration: string;
  dateResolution?: string;
  createdAt: string;
  updatedAt: string;
}

// Types pour les positions GPS
export interface Position {
  chauffeurId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
}

// Position chauffeur avec informations supplémentaires pour l'affichage
export interface ChauffeurPositionWithInfo extends Position {
  chauffeurNom?: string;
  chauffeurPrenom?: string;
  chauffeurCouleur?: string;
  isStale: boolean; // Position > 5 min
}

// Types pour la pagination
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Types pour les filtres
export interface TourneeFilters {
  date?: string;
  chauffeurId?: string;
  statut?: TourneeStatut;
}

export interface ClientFilters {
  search?: string;
  ville?: string;
  actif?: boolean;
}

// Types pour les machines et préparations
export type MachineType = 'Vegas' | 'Smakk' | 'Ring';
export type PreparationStatut =
  | 'disponible'     // Machine libre
  | 'en_preparation' // Préparation en cours
  | 'prete'         // Prête pour l'événement
  | 'en_cours'      // Événement en cours
  | 'a_decharger'   // Photos à décharger
  | 'hors_service'  // Machine hors service
  | 'archivee';     // Événement terminé et archivé

export interface Machine {
  id: string;
  type: MachineType;
  numero: string; // V1, V2, SK1, R1, etc.
  couleur?: string; // Couleur en hex (#RRGGBB)
  imageUrl?: string; // URL de l'image du type de machine
  actif: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  preparations?: Preparation[];
}

export interface Preparation {
  id: string;
  machineId: string;
  machine?: Machine;
  dateEvenement: string;
  client: string;
  preparateur: string;
  statut: PreparationStatut;
  photosDechargees: boolean;
  notes?: string;
  datePreparation: string;
  dateArchivage?: string;
  createdAt: string;
  updatedAt: string;
}

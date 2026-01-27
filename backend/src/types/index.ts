import { UserRole, TourneeStatut, PointType, PointStatut, IncidentType, IncidentStatut } from '@prisma/client';

// Ré-export des enums Prisma pour usage dans le code
export { UserRole, TourneeStatut, PointType, PointStatut, IncidentType, IncidentStatut };

// Types pour les requêtes paginées
export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Types pour les coordonnées GPS
export interface Coordinates {
  latitude: number;
  longitude: number;
}

// Types pour les filtres de recherche
export interface UserFilters {
  role?: UserRole;
  actif?: boolean;
  search?: string;
}

export interface ClientFilters {
  actif?: boolean;
  ville?: string;
  codePostal?: string;
  search?: string;
}

export interface TourneeFilters {
  chauffeurId?: string;
  statut?: TourneeStatut;
  dateDebut?: Date;
  dateFin?: Date;
}

export interface PointFilters {
  tourneeId?: string;
  clientId?: string;
  statut?: PointStatut;
  type?: PointType;
}

// Types pour la création/modification
export interface CreateUserInput {
  email: string;
  password: string;
  role: UserRole;
  nom: string;
  prenom: string;
  telephone?: string;
}

export interface UpdateUserInput {
  email?: string;
  password?: string;
  nom?: string;
  prenom?: string;
  telephone?: string;
  actif?: boolean;
}

export interface CreateClientInput {
  nom: string;
  email?: string;
  telephone?: string;
  adresse: string;
  complementAdresse?: string;
  codePostal: string;
  ville: string;
  pays?: string;
  latitude?: number;
  longitude?: number;
  instructionsAcces?: string;
  contactNom?: string;
  contactTelephone?: string;
}

export interface CreateTourneeInput {
  date: Date;
  chauffeurId: string;
  heureDepart?: string;
  depotAdresse?: string;
  depotLatitude?: number;
  depotLongitude?: number;
  notes?: string;
}

export interface CreatePointInput {
  tourneeId: string;
  clientId: string;
  type: PointType;
  ordre?: number;
  creneauDebut?: string;
  creneauFin?: string;
  dureePrevue?: number;
  notesInternes?: string;
  notesClient?: string;
  produits?: { produitId: string; quantite: number }[];
  options?: string[];
}

// Types pour le routing OSRM
export interface RouteResult {
  distance: number; // en mètres
  duration: number; // en secondes
  geometry?: string; // polyline encodée
}

export interface MatrixResult {
  durations: number[][]; // matrice NxN en secondes
  distances: number[][]; // matrice NxN en mètres
}

// Types pour l'optimisation
export interface OptimizedRoute {
  ordre: string[]; // IDs des points dans l'ordre optimal
  distanceTotale: number; // km
  dureeTotale: number; // minutes
  heuresArrivee: Record<string, string>; // pointId -> heure estimée
}

// Types pour les WebSockets
export interface PositionPayload {
  chauffeurId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
}

export interface PointUpdatePayload {
  pointId: string;
  tourneeId: string;
  statut: PointStatut;
  chauffeurId: string;
  timestamp: number;
}

export interface IncidentPayload {
  pointId: string;
  tourneeId: string;
  chauffeurId: string;
  type: IncidentType;
  description: string;
  timestamp: number;
}

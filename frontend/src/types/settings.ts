// ============================================
// Types pour les parametres tenant (Tenant.config)
// ============================================

// --- Section 1: Secteur & Metier ---

export type Verticale =
  | 'sante' | 'btp' | 'retail' | 'maintenance_industrielle' | 'luxe'
  | 'messagerie_express' | 'dechets' | 'restauration_collective' | 'ecommerce'
  | 'pharmaceutique' | 'energie' | 'telecoms' | 'agriculture' | 'textile'
  | 'automobile' | 'electromenager' | 'informatique_it' | 'demenagement'
  | 'courrier_postal' | 'vending_distribution' | 'soins_domicile' | 'securite'
  | 'nettoyage_industriel' | 'evenementiel';

export type NatureMission =
  | 'livraison_simple' | 'collecte_reverse' | 'installation_complexe'
  | 'depannage_urgence' | 'reapprovisionnement' | 'visite_commerciale'
  | 'soins_domicile' | 'audit_inspection' | 'releve_compteurs'
  | 'maintenance_preventive' | 'maintenance_corrective' | 'sav'
  | 'demenagement' | 'enlevement_deee';

export type Certification =
  | 'habilitation_electrique' | 'caces' | 'adr' | 'fluides_frigorigenes'
  | 'ssiap' | 'sst' | 'port_arme' | 'permis_c_ce_d' | 'fimo_fco'
  | 'attestation_capacite_transport';

export interface SecteurMetier {
  verticale: Verticale | '';
  naturesMission: NatureMission[];
  certificationsRequises: Certification[];
}

// --- Section 2: Flotte & Materiel ---

export type TypeVehicule =
  | 'velo_cargo' | 'scooter' | 'voiture' | 'utilitaire_leger' | 'fourgon'
  | 'van' | 'camion_porteur' | 'poids_lourd' | 'semi_remorque' | 'drone'
  | 'pieton' | 'triporteur' | 'camion_grue' | 'nacelle' | 'vehicule_frigorifique';

export type SousTypeTemperature = 'froid_positif' | 'froid_negatif' | 'bi_temp' | 'tri_temp';

export type EquipementTerrain =
  | 'pda_scanner' | 'terminal_paiement' | 'outillage_diagnostic'
  | 'stock_pieces_detachees' | 'epi' | 'camera_thermique' | 'multimetre'
  | 'detecteur_gaz' | 'mallette_outils' | 'chariot_diable';

export interface AttributsVehicule {
  hayonElevateur: boolean;
  grueEmbarquee: boolean;
  temperatureDirigee: boolean;
  sousTypeTemperature: SousTypeTemperature | '';
  compartimentageVariable: boolean;
  remorqueDecrochable: boolean;
  gpsIntegre: boolean;
  dashcam: boolean;
  balisageSignalisation: boolean;
  arrimagesCertifie: boolean;
  transpaletteEmbarque: boolean;
}

export interface FlotteMateriel {
  typesVehicules: TypeVehicule[];
  attributsVehicule: AttributsVehicule;
  equipementsTerrain: EquipementTerrain[];
}

// --- Section 3: Chargement & Flux ---

export type ContrainteChargement =
  | 'lifo' | 'fifo' | 'zonage_fragilite' | 'centre_gravite'
  | 'compatibilite_adr' | 'separation_alimentaire' | 'gerbage_max';

export type UniteMesure =
  | 'palettes_europe' | 'palettes_chep' | 'demi_palettes' | 'colis'
  | 'litres' | 'metres_lineaires' | 'kg' | 'm3' | 'heure_homme'
  | 'nombre_pieces' | 'rolls' | 'bacs';

export type ProcessusDepot =
  | 'cross_docking' | 'picking_inverse' | 'pre_chargement_quai'
  | 'tournee_ramasse' | 'controle_qualite_depart' | 'scan_chargement'
  | 'pesee_vehicule';

export interface ChargementFlux {
  contraintesChargement: ContrainteChargement[];
  unitesMesure: UniteMesure[];
  processusDepot: ProcessusDepot[];
  gerbageMax: number | null;
}

// --- Section 4: Workflow Terrain ---

export type ActionLivraison =
  | 'signature_client' | 'photo_preuve' | 'scan_code_barre'
  | 'comptage_colis' | 'verification_etat' | 'remise_emargement';

export type ActionInstallation =
  | 'checklist_mise_en_service' | 'recuperation_ancien_deee'
  | 'photo_avant_apres' | 'test_fonctionnel' | 'formation_utilisateur'
  | 'pv_reception';

export type ActionMaintenance =
  | 'prise_mesures' | 'rapport_technique' | 'signature_pv'
  | 'photo_avant_apres_maintenance' | 'releve_compteur'
  | 'diagnostic_code_erreur' | 'commande_pieces';

export type ActionCollecte =
  | 'scan_retour' | 'pesee' | 'controle_conformite' | 'bordereau_reprise';

export type AnomalieActive =
  | 'absence_relais' | 'absence_voisin' | 'absence_casier'
  | 'absence_reprogrammation' | 'refus_total' | 'refus_partiel'
  | 'avarie_constatee' | 'adresse_introuvable' | 'acces_impossible'
  | 'creneau_depasse' | 'client_injoignable';

export interface WorkflowTerrain {
  actionsLivraison: ActionLivraison[];
  actionsInstallation: ActionInstallation[];
  actionsMaintenance: ActionMaintenance[];
  actionsCollecte: ActionCollecte[];
  anomaliesActives: AnomalieActive[];
}

// --- Section 5: Algorithmes & Contraintes ---

export interface FenetresTemps {
  creneauxStricts: boolean;
  rdvHeureFixe: boolean;
  prioritesVip: boolean;
  demiJourneeAmPm: boolean;
}

export interface TempsService {
  tempsFixeArret: number;
  tempsVariableUnite: number;
  tempsMontage: number;
  tempsAdministratif: number;
}

export interface PausesReglementation {
  tempsConduiteMaxRse: boolean;
  pauseDejeuner: boolean;
  pauseDejeunerDuree: number;
  zfeActif: boolean;
  heuresCreusesPointe: boolean;
  restrictionsTonnageHoraire: boolean;
  interdictionsWeekendPl: boolean;
}

export interface AlgorithmesContraintes {
  fenetresTemps: FenetresTemps;
  tempsService: TempsService;
  pausesReglementation: PausesReglementation;
}

// --- Section 6: Interface & UI ---

export type VuePrioritaire = 'carte_temps_reel' | 'liste_taches' | 'gantt_ressources' | 'timeline' | 'kanban_statuts';

export interface ChampPersonnalise {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  actif: boolean;
}

export interface Terminologie {
  tournee: string;
  chauffeur: string;
  point: string;
  vehicule: string;
}

export interface NotificationsClient {
  smsApprocheEta: boolean;
  lienTracking: boolean;
  emailConfirmation: boolean;
  enqueteSatisfaction: boolean;
  notificationRetard: boolean;
}

export interface InterfaceUi {
  vuesPrioritaires: VuePrioritaire[];
  vuePrincipale: VuePrioritaire | '';
  champsPersonnalises: ChampPersonnalise[];
  terminologie: Terminologie;
  notificationsClient: NotificationsClient;
}

// --- Config complete ---

export interface TenantSettings {
  secteurMetier: SecteurMetier;
  flotteMateriel: FlotteMateriel;
  chargementFlux: ChargementFlux;
  workflowTerrain: WorkflowTerrain;
  algorithmesContraintes: AlgorithmesContraintes;
  interfaceUi: InterfaceUi;
}

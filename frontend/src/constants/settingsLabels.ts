import type {
  Verticale, NatureMission, Certification,
  TypeVehicule, SousTypeTemperature, EquipementTerrain,
  ContrainteChargement, UniteMesure, ProcessusDepot,
  ActionLivraison, ActionInstallation, ActionMaintenance, ActionCollecte, AnomalieActive,
  VuePrioritaire,
} from '@/types/settings';

// --- Section 1: Secteur & Metier ---

export const VERTICALE_LABELS: Record<Verticale, string> = {
  sante: 'Santé',
  btp: 'BTP',
  retail: 'Retail',
  maintenance_industrielle: 'Maintenance industrielle',
  luxe: 'Luxe',
  messagerie_express: 'Messagerie express',
  dechets: 'Déchets',
  restauration_collective: 'Restauration collective',
  ecommerce: 'E-commerce',
  pharmaceutique: 'Pharmaceutique',
  energie: 'Énergie',
  telecoms: 'Télécoms',
  agriculture: 'Agriculture',
  textile: 'Textile',
  automobile: 'Automobile',
  electromenager: 'Électroménager',
  informatique_it: 'Informatique / IT',
  demenagement: 'Déménagement',
  courrier_postal: 'Courrier / Postal',
  vending_distribution: 'Vending / Distribution auto',
  soins_domicile: 'Soins à domicile',
  securite: 'Sécurité',
  nettoyage_industriel: 'Nettoyage industriel',
  evenementiel: 'Événementiel',
};

export const NATURE_MISSION_LABELS: Record<NatureMission, string> = {
  livraison_simple: 'Livraison simple',
  collecte_reverse: 'Collecte / Reverse logistics',
  installation_complexe: 'Installation complexe / White glove',
  depannage_urgence: 'Dépannage urgence',
  reapprovisionnement: 'Réapprovisionnement',
  visite_commerciale: 'Visite commerciale',
  soins_domicile: 'Soins à domicile',
  audit_inspection: 'Audit / Inspection',
  releve_compteurs: 'Relevé compteurs',
  maintenance_preventive: 'Maintenance préventive',
  maintenance_corrective: 'Maintenance corrective',
  sav: 'SAV',
  demenagement: 'Déménagement',
  enlevement_deee: 'Enlèvement DEEE',
};

export const CERTIFICATION_LABELS: Record<Certification, string> = {
  habilitation_electrique: 'Habilitation électrique',
  caces: 'CACES',
  adr: 'ADR',
  fluides_frigorigenes: 'Fluides frigorigènes',
  ssiap: 'SSIAP',
  sst: 'SST',
  port_arme: "Port d'arme",
  permis_c_ce_d: 'Permis C / CE / D',
  fimo_fco: 'FIMO / FCO',
  attestation_capacite_transport: 'Attestation capacité transport',
};

// --- Section 2: Flotte & Materiel ---

export const TYPE_VEHICULE_LABELS: Record<TypeVehicule, string> = {
  velo_cargo: 'Vélo cargo',
  scooter: 'Scooter',
  voiture: 'Voiture',
  utilitaire_leger: 'Utilitaire léger',
  fourgon: 'Fourgon',
  van: 'Van',
  camion_porteur: 'Camion porteur',
  poids_lourd: 'Poids lourd',
  semi_remorque: 'Semi-remorque',
  drone: 'Drone',
  pieton: 'Piéton',
  triporteur: 'Triporteur',
  camion_grue: 'Camion-grue',
  nacelle: 'Nacelle',
  vehicule_frigorifique: 'Véhicule frigorifique',
};

export const SOUS_TYPE_TEMPERATURE_LABELS: Record<SousTypeTemperature, string> = {
  froid_positif: 'Froid positif',
  froid_negatif: 'Froid négatif',
  bi_temp: 'Bi-température',
  tri_temp: 'Tri-température',
};

export const EQUIPEMENT_TERRAIN_LABELS: Record<EquipementTerrain, string> = {
  pda_scanner: 'PDA / Scanner',
  terminal_paiement: 'Terminal paiement',
  outillage_diagnostic: 'Outillage diagnostic',
  stock_pieces_detachees: 'Stock pièces détachées',
  epi: 'EPI',
  camera_thermique: 'Caméra thermique',
  multimetre: 'Multimètre',
  detecteur_gaz: 'Détecteur gaz',
  mallette_outils: 'Mallette outils',
  chariot_diable: 'Chariot / Diable',
};

// --- Section 3: Chargement & Flux ---

export const CONTRAINTE_CHARGEMENT_LABELS: Record<ContrainteChargement, string> = {
  lifo: 'LIFO',
  fifo: 'FIFO',
  zonage_fragilite: 'Zonage fragilité',
  centre_gravite: 'Centre de gravité',
  compatibilite_adr: 'Compatibilité ADR',
  separation_alimentaire: 'Séparation alimentaire',
  gerbage_max: 'Gerbage max',
};

export const UNITE_MESURE_LABELS: Record<UniteMesure, string> = {
  palettes_europe: 'Palettes Europe',
  palettes_chep: 'Palettes Chep',
  demi_palettes: 'Demi-palettes',
  colis: 'Colis',
  litres: 'Litres',
  metres_lineaires: 'Mètres linéaires',
  kg: 'Kg',
  m3: 'M³',
  heure_homme: 'Heure-homme',
  nombre_pieces: 'Nombre pièces',
  rolls: 'Rolls',
  bacs: 'Bacs',
};

export const PROCESSUS_DEPOT_LABELS: Record<ProcessusDepot, string> = {
  cross_docking: 'Cross-docking',
  picking_inverse: 'Picking inverse',
  pre_chargement_quai: 'Pré-chargement quai',
  tournee_ramasse: 'Tournée ramasse',
  controle_qualite_depart: 'Contrôle qualité départ',
  scan_chargement: 'Scan chargement',
  pesee_vehicule: 'Pesée véhicule',
};

// --- Section 4: Workflow Terrain ---

export const ACTION_LIVRAISON_LABELS: Record<ActionLivraison, string> = {
  signature_client: 'Signature client',
  photo_preuve: 'Photo preuve',
  scan_code_barre: 'Scan code-barre SSCC/EAN',
  comptage_colis: 'Comptage colis',
  verification_etat: 'Vérification état',
  remise_emargement: 'Remise émargement',
};

export const ACTION_INSTALLATION_LABELS: Record<ActionInstallation, string> = {
  checklist_mise_en_service: 'Checklist mise en service',
  recuperation_ancien_deee: 'Récupération ancien matériel DEEE',
  photo_avant_apres: 'Photo avant/après',
  test_fonctionnel: 'Test fonctionnel',
  formation_utilisateur: 'Formation utilisateur',
  pv_reception: 'PV réception',
};

export const ACTION_MAINTENANCE_LABELS: Record<ActionMaintenance, string> = {
  prise_mesures: 'Prise de mesures',
  rapport_technique: 'Rapport technique',
  signature_pv: 'Signature PV',
  photo_avant_apres_maintenance: 'Photo avant/après',
  releve_compteur: 'Relevé compteur',
  diagnostic_code_erreur: 'Diagnostic code erreur',
  commande_pieces: 'Commande pièces',
};

export const ACTION_COLLECTE_LABELS: Record<ActionCollecte, string> = {
  scan_retour: 'Scan retour',
  pesee: 'Pesée',
  controle_conformite: 'Contrôle conformité',
  bordereau_reprise: 'Bordereau reprise',
};

export const ANOMALIE_ACTIVE_LABELS: Record<AnomalieActive, string> = {
  absence_relais: 'Absence → Relais',
  absence_voisin: 'Absence → Voisin',
  absence_casier: 'Absence → Casier',
  absence_reprogrammation: 'Absence → Reprogrammation',
  refus_total: 'Refus total',
  refus_partiel: 'Refus partiel',
  avarie_constatee: 'Avarie constatée',
  adresse_introuvable: 'Adresse introuvable',
  acces_impossible: 'Accès impossible',
  creneau_depasse: 'Créneau dépassé',
  client_injoignable: 'Client injoignable',
};

// --- Section 5: Algorithmes & Contraintes ---
// (pas d'enums, uniquement des toggles et inputs)

// --- Section 6: Interface & UI ---

export const VUE_PRIORITAIRE_LABELS: Record<VuePrioritaire, string> = {
  carte_temps_reel: 'Carte temps réel',
  liste_taches: 'Liste tâches',
  gantt_ressources: 'Gantt ressources',
  timeline: 'Timeline',
  kanban_statuts: 'Kanban statuts',
};

export const CHAMPS_PERSONNALISES_PREDEFINIS = [
  { key: 'digicode', label: 'Digicode', type: 'text' as const },
  { key: 'instructions_speciales', label: 'Instructions spéciales', type: 'text' as const },
  { key: 'etage', label: 'Étage', type: 'number' as const },
  { key: 'monte_charge', label: 'Monte-charge', type: 'boolean' as const },
  { key: 'contact_sur_place', label: 'Contact sur place', type: 'text' as const },
  { key: 'reference_client', label: 'Référence client', type: 'text' as const },
  { key: 'n_bon_commande', label: 'N° bon commande', type: 'text' as const },
  { key: 'creneau_prefere', label: 'Créneau préféré', type: 'select' as const },
];

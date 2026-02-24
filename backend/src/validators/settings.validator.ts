import { z } from 'zod';

// --- Section 1: Secteur & Metier ---

const verticaleEnum = z.enum([
  'sante', 'btp', 'retail', 'maintenance_industrielle', 'luxe',
  'messagerie_express', 'dechets', 'restauration_collective', 'ecommerce',
  'pharmaceutique', 'energie', 'telecoms', 'agriculture', 'textile',
  'automobile', 'electromenager', 'informatique_it', 'demenagement',
  'courrier_postal', 'vending_distribution', 'soins_domicile', 'securite',
  'nettoyage_industriel', 'evenementiel',
]);

const natureMissionEnum = z.enum([
  'livraison_simple', 'collecte_reverse', 'installation_complexe',
  'depannage_urgence', 'reapprovisionnement', 'visite_commerciale',
  'soins_domicile', 'audit_inspection', 'releve_compteurs',
  'maintenance_preventive', 'maintenance_corrective', 'sav',
  'demenagement', 'enlevement_deee',
]);

const certificationEnum = z.enum([
  'habilitation_electrique', 'caces', 'adr', 'fluides_frigorigenes',
  'ssiap', 'sst', 'port_arme', 'permis_c_ce_d', 'fimo_fco',
  'attestation_capacite_transport',
]);

const secteurMetierSchema = z.object({
  verticale: z.union([verticaleEnum, z.literal('')]).optional(),
  naturesMission: z.array(natureMissionEnum).optional(),
  certificationsRequises: z.array(certificationEnum).optional(),
}).partial();

// --- Section 2: Flotte & Materiel ---

const typeVehiculeEnum = z.enum([
  'velo_cargo', 'scooter', 'voiture', 'utilitaire_leger', 'fourgon',
  'van', 'camion_porteur', 'poids_lourd', 'semi_remorque', 'drone',
  'pieton', 'triporteur', 'camion_grue', 'nacelle', 'vehicule_frigorifique',
]);

const sousTypeTemperatureEnum = z.enum([
  'froid_positif', 'froid_negatif', 'bi_temp', 'tri_temp',
]);

const equipementTerrainEnum = z.enum([
  'pda_scanner', 'terminal_paiement', 'outillage_diagnostic',
  'stock_pieces_detachees', 'epi', 'camera_thermique', 'multimetre',
  'detecteur_gaz', 'mallette_outils', 'chariot_diable',
]);

const attributsVehiculeSchema = z.object({
  hayonElevateur: z.boolean().optional(),
  grueEmbarquee: z.boolean().optional(),
  temperatureDirigee: z.boolean().optional(),
  sousTypeTemperature: z.union([sousTypeTemperatureEnum, z.literal('')]).optional(),
  compartimentageVariable: z.boolean().optional(),
  remorqueDecrochable: z.boolean().optional(),
  gpsIntegre: z.boolean().optional(),
  dashcam: z.boolean().optional(),
  balisageSignalisation: z.boolean().optional(),
  arrimagesCertifie: z.boolean().optional(),
  transpaletteEmbarque: z.boolean().optional(),
}).partial();

const flotteMaterielSchema = z.object({
  typesVehicules: z.array(typeVehiculeEnum).optional(),
  attributsVehicule: attributsVehiculeSchema.optional(),
  equipementsTerrain: z.array(equipementTerrainEnum).optional(),
}).partial();

// --- Section 3: Chargement & Flux ---

const contrainteChargementEnum = z.enum([
  'lifo', 'fifo', 'zonage_fragilite', 'centre_gravite',
  'compatibilite_adr', 'separation_alimentaire', 'gerbage_max',
]);

const uniteMesureEnum = z.enum([
  'palettes_europe', 'palettes_chep', 'demi_palettes', 'colis',
  'litres', 'metres_lineaires', 'kg', 'm3', 'heure_homme',
  'nombre_pieces', 'rolls', 'bacs',
]);

const processusDepotEnum = z.enum([
  'cross_docking', 'picking_inverse', 'pre_chargement_quai',
  'tournee_ramasse', 'controle_qualite_depart', 'scan_chargement',
  'pesee_vehicule',
]);

const chargementFluxSchema = z.object({
  contraintesChargement: z.array(contrainteChargementEnum).optional(),
  unitesMesure: z.array(uniteMesureEnum).optional(),
  processusDepot: z.array(processusDepotEnum).optional(),
  gerbageMax: z.number().int().min(0).nullable().optional(),
}).partial();

// --- Section 4: Workflow Terrain ---

const actionLivraisonEnum = z.enum([
  'signature_client', 'photo_preuve', 'scan_code_barre',
  'comptage_colis', 'verification_etat', 'remise_emargement',
]);

const actionInstallationEnum = z.enum([
  'checklist_mise_en_service', 'recuperation_ancien_deee',
  'photo_avant_apres', 'test_fonctionnel', 'formation_utilisateur',
  'pv_reception',
]);

const actionMaintenanceEnum = z.enum([
  'prise_mesures', 'rapport_technique', 'signature_pv',
  'photo_avant_apres_maintenance', 'releve_compteur',
  'diagnostic_code_erreur', 'commande_pieces',
]);

const actionCollecteEnum = z.enum([
  'scan_retour', 'pesee', 'controle_conformite', 'bordereau_reprise',
]);

const anomalieActiveEnum = z.enum([
  'absence_relais', 'absence_voisin', 'absence_casier',
  'absence_reprogrammation', 'refus_total', 'refus_partiel',
  'avarie_constatee', 'adresse_introuvable', 'acces_impossible',
  'creneau_depasse', 'client_injoignable',
]);

const workflowTerrainSchema = z.object({
  actionsLivraison: z.array(actionLivraisonEnum).optional(),
  actionsInstallation: z.array(actionInstallationEnum).optional(),
  actionsMaintenance: z.array(actionMaintenanceEnum).optional(),
  actionsCollecte: z.array(actionCollecteEnum).optional(),
  anomaliesActives: z.array(anomalieActiveEnum).optional(),
}).partial();

// --- Section 5: Algorithmes & Contraintes ---

const fenetresTempsSchema = z.object({
  creneauxStricts: z.boolean().optional(),
  rdvHeureFixe: z.boolean().optional(),
  prioritesVip: z.boolean().optional(),
  demiJourneeAmPm: z.boolean().optional(),
}).partial();

const tempsServiceSchema = z.object({
  tempsFixeArret: z.number().min(0).optional(),
  tempsVariableUnite: z.number().min(0).optional(),
  tempsMontage: z.number().min(0).optional(),
  tempsAdministratif: z.number().min(0).optional(),
}).partial();

const pausesReglementationSchema = z.object({
  tempsConduiteMaxRse: z.boolean().optional(),
  pauseDejeuner: z.boolean().optional(),
  pauseDejeunerDuree: z.number().min(0).optional(),
  zfeActif: z.boolean().optional(),
  heuresCreusesPointe: z.boolean().optional(),
  restrictionsTonnageHoraire: z.boolean().optional(),
  interdictionsWeekendPl: z.boolean().optional(),
}).partial();

const algorithmesContraintesSchema = z.object({
  fenetresTemps: fenetresTempsSchema.optional(),
  tempsService: tempsServiceSchema.optional(),
  pausesReglementation: pausesReglementationSchema.optional(),
}).partial();

// --- Section 6: Interface & UI ---

const vuePrioritaireEnum = z.enum([
  'carte_temps_reel', 'liste_taches', 'gantt_ressources', 'timeline', 'kanban_statuts',
]);

const champPersonnaliseSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  type: z.enum(['text', 'number', 'select', 'boolean']),
  actif: z.boolean(),
});

const terminologieSchema = z.object({
  tournee: z.string().max(50).optional(),
  chauffeur: z.string().max(50).optional(),
  point: z.string().max(50).optional(),
  vehicule: z.string().max(50).optional(),
}).partial();

const notificationsClientSchema = z.object({
  smsApprocheEta: z.boolean().optional(),
  lienTracking: z.boolean().optional(),
  emailConfirmation: z.boolean().optional(),
  enqueteSatisfaction: z.boolean().optional(),
  notificationRetard: z.boolean().optional(),
}).partial();

const interfaceUiSchema = z.object({
  vuesPrioritaires: z.array(vuePrioritaireEnum).optional(),
  vuePrincipale: z.union([vuePrioritaireEnum, z.literal('')]).optional(),
  champsPersonnalises: z.array(champPersonnaliseSchema).optional(),
  terminologie: terminologieSchema.optional(),
  notificationsClient: notificationsClientSchema.optional(),
}).partial();

// --- Schema principal (toutes les sections optionnelles) ---

export const updateSettingsSchema = z.object({
  secteurMetier: secteurMetierSchema.optional(),
  flotteMateriel: flotteMaterielSchema.optional(),
  chargementFlux: chargementFluxSchema.optional(),
  workflowTerrain: workflowTerrainSchema.optional(),
  algorithmesContraintes: algorithmesContraintesSchema.optional(),
  interfaceUi: interfaceUiSchema.optional(),
}).partial();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

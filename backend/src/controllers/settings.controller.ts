import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';

// Valeurs par defaut pour toutes les sections
const DEFAULT_SETTINGS = {
  secteurMetier: {
    verticale: '',
    naturesMission: [],
    certificationsRequises: [],
  },
  flotteMateriel: {
    typesVehicules: [],
    attributsVehicule: {
      hayonElevateur: false,
      grueEmbarquee: false,
      temperatureDirigee: false,
      sousTypeTemperature: '',
      compartimentageVariable: false,
      remorqueDecrochable: false,
      gpsIntegre: false,
      dashcam: false,
      balisageSignalisation: false,
      arrimagesCertifie: false,
      transpaletteEmbarque: false,
    },
    equipementsTerrain: [],
  },
  chargementFlux: {
    contraintesChargement: [],
    unitesMesure: [],
    processusDepot: [],
    gerbageMax: null,
  },
  workflowTerrain: {
    actionsLivraison: [],
    actionsInstallation: [],
    actionsMaintenance: [],
    actionsCollecte: [],
    anomaliesActives: [],
  },
  algorithmesContraintes: {
    fenetresTemps: {
      creneauxStricts: false,
      rdvHeureFixe: false,
      prioritesVip: false,
      demiJourneeAmPm: false,
    },
    tempsService: {
      tempsFixeArret: 5,
      tempsVariableUnite: 1,
      tempsMontage: 0,
      tempsAdministratif: 0,
    },
    pausesReglementation: {
      tempsConduiteMaxRse: false,
      pauseDejeuner: false,
      pauseDejeunerDuree: 60,
      zfeActif: false,
      heuresCreusesPointe: false,
      restrictionsTonnageHoraire: false,
      interdictionsWeekendPl: false,
    },
  },
  interfaceUi: {
    vuesPrioritaires: ['carte_temps_reel', 'liste_taches'],
    vuePrincipale: 'carte_temps_reel',
    champsPersonnalises: [
      { key: 'digicode', label: 'Digicode', type: 'text', actif: true },
      { key: 'instructions_speciales', label: 'Instructions spéciales', type: 'text', actif: true },
      { key: 'etage', label: 'Étage', type: 'number', actif: false },
      { key: 'monte_charge', label: 'Monte-charge', type: 'boolean', actif: false },
      { key: 'contact_sur_place', label: 'Contact sur place', type: 'text', actif: false },
      { key: 'reference_client', label: 'Référence client', type: 'text', actif: false },
      { key: 'n_bon_commande', label: 'N° bon commande', type: 'text', actif: false },
      { key: 'creneau_prefere', label: 'Créneau préféré', type: 'select', actif: false },
    ],
    terminologie: {
      tournee: 'Tournée',
      chauffeur: 'Chauffeur',
      point: 'Point',
      vehicule: 'Véhicule',
    },
    notificationsClient: {
      smsApprocheEta: false,
      lienTracking: false,
      emailConfirmation: false,
      enqueteSatisfaction: false,
      notificationRetard: false,
    },
  },
};

/**
 * Deep merge: objets merges recursivement, arrays remplaces entierement
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

export const settingsController = {
  /**
   * GET /api/settings
   * Retourne la config settings du tenant avec deep merge des defaults
   */
  async get(req: Request, res: Response): Promise<void> {
    const tenantId = req.user!.tenantId;

    if (!tenantId) {
      apiResponse.badRequest(res, 'Aucun tenant associé');
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { config: true },
    });

    if (!tenant) {
      apiResponse.notFound(res, 'Tenant non trouvé');
      return;
    }

    // Deep merge: defaults + config existante
    const existingConfig = (tenant.config as Record<string, unknown>) || {};
    const settings = deepMerge(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      existingConfig
    );

    apiResponse.success(res, settings);
  },

  /**
   * PUT /api/settings
   * Met a jour partiellement la config settings du tenant
   */
  async update(req: Request, res: Response): Promise<void> {
    const tenantId = req.user!.tenantId;

    if (!tenantId) {
      apiResponse.badRequest(res, 'Aucun tenant associé');
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { config: true },
    });

    if (!tenant) {
      apiResponse.notFound(res, 'Tenant non trouvé');
      return;
    }

    // Deep merge: config existante + nouvelles valeurs
    const existingConfig = (tenant.config as Record<string, unknown>) || {};
    const newConfig = deepMerge(existingConfig, req.body as Record<string, unknown>);

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { config: newConfig },
    });

    // Retourner la config finale avec defaults
    const finalSettings = deepMerge(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      newConfig
    );

    apiResponse.success(res, finalSettings, 'Paramètres mis à jour');
  },
};

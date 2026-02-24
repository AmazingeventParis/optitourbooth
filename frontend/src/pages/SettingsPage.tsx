import { useState, useEffect, useCallback } from 'react';
import {
  BuildingStorefrontIcon,
  TruckIcon,
  CubeIcon,
  ClipboardDocumentCheckIcon,
  CpuChipIcon,
  PaintBrushIcon,
} from '@heroicons/react/24/outline';
import { Card, CardHeader, Button } from '@/components/ui';
import Tabs, { Tab } from '@/components/ui/Tabs';
import Toggle from '@/components/ui/Toggle';
import SettingSection from '@/components/settings/SettingSection';
import MultiSelectCheckbox from '@/components/settings/MultiSelectCheckbox';
import { settingsService } from '@/services/settings.service';
import { useToast } from '@/hooks/useToast';
import type {
  TenantSettings,
  SecteurMetier, FlotteMateriel, ChargementFlux,
  WorkflowTerrain, AlgorithmesContraintes, InterfaceUi,
  ChampPersonnalise,
} from '@/types/settings';
import {
  VERTICALE_LABELS, NATURE_MISSION_LABELS, CERTIFICATION_LABELS,
  TYPE_VEHICULE_LABELS, SOUS_TYPE_TEMPERATURE_LABELS, EQUIPEMENT_TERRAIN_LABELS,
  CONTRAINTE_CHARGEMENT_LABELS, UNITE_MESURE_LABELS, PROCESSUS_DEPOT_LABELS,
  ACTION_LIVRAISON_LABELS, ACTION_INSTALLATION_LABELS, ACTION_MAINTENANCE_LABELS,
  ACTION_COLLECTE_LABELS, ANOMALIE_ACTIVE_LABELS,
  VUE_PRIORITAIRE_LABELS,
} from '@/constants/settingsLabels';

const TABS: Tab[] = [
  { key: 'secteur', label: 'Secteur & Métier', icon: BuildingStorefrontIcon },
  { key: 'flotte', label: 'Flotte & Matériel', icon: TruckIcon },
  { key: 'chargement', label: 'Chargement & Flux', icon: CubeIcon },
  { key: 'workflow', label: 'Workflow Terrain', icon: ClipboardDocumentCheckIcon },
  { key: 'algorithmes', label: 'Algorithmes & Temps', icon: CpuChipIcon },
  { key: 'interface', label: 'Interface & UI', icon: PaintBrushIcon },
];

function labelsToOptions(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('secteur');
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { success, error: showError } = useToast();

  // Local section states
  const [secteur, setSecteur] = useState<SecteurMetier | null>(null);
  const [flotte, setFlotte] = useState<FlotteMateriel | null>(null);
  const [chargement, setChargement] = useState<ChargementFlux | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowTerrain | null>(null);
  const [algorithmes, setAlgorithmes] = useState<AlgorithmesContraintes | null>(null);
  const [interfaceUi, setInterfaceUi] = useState<InterfaceUi | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsService.get();
      setSettings(data);
      setSecteur(data.secteurMetier);
      setFlotte(data.flotteMateriel);
      setChargement(data.chargementFlux);
      setWorkflow(data.workflowTerrain);
      setAlgorithmes(data.algorithmesContraintes);
      setInterfaceUi(data.interfaceUi);
    } catch {
      showError('Erreur', 'Impossible de charger les paramètres');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const sectionMap: Record<string, Partial<TenantSettings>> = {
        secteur: { secteurMetier: secteur! },
        flotte: { flotteMateriel: flotte! },
        chargement: { chargementFlux: chargement! },
        workflow: { workflowTerrain: workflow! },
        algorithmes: { algorithmesContraintes: algorithmes! },
        interface: { interfaceUi: interfaceUi! },
      };
      const data = await settingsService.update(sectionMap[activeTab]);
      setSettings(data);
      success('Paramètres sauvegardés');
    } catch {
      showError('Erreur', 'Impossible de sauvegarder les paramètres');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings || !secteur || !flotte || !chargement || !workflow || !algorithmes || !interfaceUi) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configurez votre espace selon votre activité, votre flotte et vos processus métier.
        </p>
      </div>

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <Card>
        <CardHeader
          title={TABS.find((t) => t.key === activeTab)?.label || ''}
          action={
            <Button onClick={handleSave} isLoading={saving} size="sm">
              Sauvegarder
            </Button>
          }
        />

        <div className="p-6 space-y-4">
          {activeTab === 'secteur' && (
            <SecteurTab value={secteur} onChange={setSecteur} />
          )}
          {activeTab === 'flotte' && (
            <FlotteTab value={flotte} onChange={setFlotte} />
          )}
          {activeTab === 'chargement' && (
            <ChargementTab value={chargement} onChange={setChargement} />
          )}
          {activeTab === 'workflow' && (
            <WorkflowTab value={workflow} onChange={setWorkflow} />
          )}
          {activeTab === 'algorithmes' && (
            <AlgorithmesTab value={algorithmes} onChange={setAlgorithmes} />
          )}
          {activeTab === 'interface' && (
            <InterfaceTab value={interfaceUi} onChange={setInterfaceUi} />
          )}
        </div>
      </Card>
    </div>
  );
}

// ===== Onglet Secteur & Metier =====

function SecteurTab({ value, onChange }: { value: SecteurMetier; onChange: (v: SecteurMetier) => void }) {
  return (
    <>
      <SettingSection title="Verticale" description="Secteur d'activité principal">
        <select
          value={value.verticale}
          onChange={(e) => onChange({ ...value, verticale: e.target.value as SecteurMetier['verticale'] })}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
        >
          <option value="">-- Sélectionner --</option>
          {Object.entries(VERTICALE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </SettingSection>

      <SettingSection title="Natures de mission" description="Types de missions réalisées">
        <MultiSelectCheckbox
          options={labelsToOptions(NATURE_MISSION_LABELS)}
          selected={value.naturesMission}
          onChange={(v) => onChange({ ...value, naturesMission: v as SecteurMetier['naturesMission'] })}
        />
      </SettingSection>

      <SettingSection title="Certifications requises" description="Habilitations et certifications nécessaires">
        <MultiSelectCheckbox
          options={labelsToOptions(CERTIFICATION_LABELS)}
          selected={value.certificationsRequises}
          onChange={(v) => onChange({ ...value, certificationsRequises: v as SecteurMetier['certificationsRequises'] })}
        />
      </SettingSection>
    </>
  );
}

// ===== Onglet Flotte & Materiel =====

function FlotteTab({ value, onChange }: { value: FlotteMateriel; onChange: (v: FlotteMateriel) => void }) {
  const attr = value.attributsVehicule;
  const setAttr = (patch: Partial<FlotteMateriel['attributsVehicule']>) =>
    onChange({ ...value, attributsVehicule: { ...attr, ...patch } });

  return (
    <>
      <SettingSection title="Types de véhicules" description="Véhicules utilisés dans votre flotte">
        <MultiSelectCheckbox
          options={labelsToOptions(TYPE_VEHICULE_LABELS)}
          selected={value.typesVehicules}
          onChange={(v) => onChange({ ...value, typesVehicules: v as FlotteMateriel['typesVehicules'] })}
        />
      </SettingSection>

      <SettingSection title="Attributs véhicule" description="Équipements et options embarqués">
        <div className="space-y-3">
          <Toggle label="Hayon élévateur" checked={attr.hayonElevateur} onChange={(v) => setAttr({ hayonElevateur: v })} />
          <Toggle label="Grue embarquée" checked={attr.grueEmbarquee} onChange={(v) => setAttr({ grueEmbarquee: v })} />
          <Toggle label="Température dirigée" checked={attr.temperatureDirigee} onChange={(v) => setAttr({ temperatureDirigee: v })} />
          {attr.temperatureDirigee && (
            <div className="ml-6">
              <label className="text-xs text-gray-500 mb-1 block">Sous-type température</label>
              <select
                value={attr.sousTypeTemperature}
                onChange={(e) => setAttr({ sousTypeTemperature: e.target.value as FlotteMateriel['attributsVehicule']['sousTypeTemperature'] })}
                className="block w-full max-w-xs rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              >
                <option value="">-- Sélectionner --</option>
                {Object.entries(SOUS_TYPE_TEMPERATURE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
          )}
          <Toggle label="Compartimentage variable" checked={attr.compartimentageVariable} onChange={(v) => setAttr({ compartimentageVariable: v })} />
          <Toggle label="Remorque décrochable" checked={attr.remorqueDecrochable} onChange={(v) => setAttr({ remorqueDecrochable: v })} />
          <Toggle label="GPS intégré" checked={attr.gpsIntegre} onChange={(v) => setAttr({ gpsIntegre: v })} />
          <Toggle label="Dashcam" checked={attr.dashcam} onChange={(v) => setAttr({ dashcam: v })} />
          <Toggle label="Balisage signalisation" checked={attr.balisageSignalisation} onChange={(v) => setAttr({ balisageSignalisation: v })} />
          <Toggle label="Arrimage certifié" checked={attr.arrimagesCertifie} onChange={(v) => setAttr({ arrimagesCertifie: v })} />
          <Toggle label="Transpalette embarqué" checked={attr.transpaletteEmbarque} onChange={(v) => setAttr({ transpaletteEmbarque: v })} />
        </div>
      </SettingSection>

      <SettingSection title="Équipements terrain" description="Matériel embarqué pour les équipes">
        <MultiSelectCheckbox
          options={labelsToOptions(EQUIPEMENT_TERRAIN_LABELS)}
          selected={value.equipementsTerrain}
          onChange={(v) => onChange({ ...value, equipementsTerrain: v as FlotteMateriel['equipementsTerrain'] })}
        />
      </SettingSection>
    </>
  );
}

// ===== Onglet Chargement & Flux =====

function ChargementTab({ value, onChange }: { value: ChargementFlux; onChange: (v: ChargementFlux) => void }) {
  return (
    <>
      <SettingSection title="Contraintes de chargement" description="Règles de chargement véhicule">
        <MultiSelectCheckbox
          options={labelsToOptions(CONTRAINTE_CHARGEMENT_LABELS)}
          selected={value.contraintesChargement}
          onChange={(v) => onChange({ ...value, contraintesChargement: v as ChargementFlux['contraintesChargement'] })}
          columns={2}
        />
        {value.contraintesChargement.includes('gerbage_max') && (
          <div className="mt-3">
            <label className="text-xs text-gray-500 mb-1 block">Gerbage max (niveaux)</label>
            <input
              type="number"
              min={0}
              value={value.gerbageMax ?? ''}
              onChange={(e) => onChange({ ...value, gerbageMax: e.target.value ? parseInt(e.target.value) : null })}
              className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
            />
          </div>
        )}
      </SettingSection>

      <SettingSection title="Unités de mesure" description="Unités utilisées pour quantifier les flux">
        <MultiSelectCheckbox
          options={labelsToOptions(UNITE_MESURE_LABELS)}
          selected={value.unitesMesure}
          onChange={(v) => onChange({ ...value, unitesMesure: v as ChargementFlux['unitesMesure'] })}
        />
      </SettingSection>

      <SettingSection title="Processus dépôt" description="Opérations au dépôt avant départ">
        <MultiSelectCheckbox
          options={labelsToOptions(PROCESSUS_DEPOT_LABELS)}
          selected={value.processusDepot}
          onChange={(v) => onChange({ ...value, processusDepot: v as ChargementFlux['processusDepot'] })}
          columns={2}
        />
      </SettingSection>
    </>
  );
}

// ===== Onglet Workflow Terrain =====

function WorkflowTab({ value, onChange }: { value: WorkflowTerrain; onChange: (v: WorkflowTerrain) => void }) {
  return (
    <>
      <SettingSection title="Actions livraison" description="Étapes à effectuer lors d'une livraison">
        <MultiSelectCheckbox
          options={labelsToOptions(ACTION_LIVRAISON_LABELS)}
          selected={value.actionsLivraison}
          onChange={(v) => onChange({ ...value, actionsLivraison: v as WorkflowTerrain['actionsLivraison'] })}
          columns={2}
        />
      </SettingSection>

      <SettingSection title="Actions installation" description="Étapes pour une installation / mise en service">
        <MultiSelectCheckbox
          options={labelsToOptions(ACTION_INSTALLATION_LABELS)}
          selected={value.actionsInstallation}
          onChange={(v) => onChange({ ...value, actionsInstallation: v as WorkflowTerrain['actionsInstallation'] })}
          columns={2}
        />
      </SettingSection>

      <SettingSection title="Actions maintenance" description="Étapes pour une intervention de maintenance">
        <MultiSelectCheckbox
          options={labelsToOptions(ACTION_MAINTENANCE_LABELS)}
          selected={value.actionsMaintenance}
          onChange={(v) => onChange({ ...value, actionsMaintenance: v as WorkflowTerrain['actionsMaintenance'] })}
          columns={2}
        />
      </SettingSection>

      <SettingSection title="Actions collecte" description="Étapes pour une collecte / reprise">
        <MultiSelectCheckbox
          options={labelsToOptions(ACTION_COLLECTE_LABELS)}
          selected={value.actionsCollecte}
          onChange={(v) => onChange({ ...value, actionsCollecte: v as WorkflowTerrain['actionsCollecte'] })}
          columns={2}
        />
      </SettingSection>

      <SettingSection title="Anomalies actives" description="Types d'anomalies disponibles pour les chauffeurs">
        <MultiSelectCheckbox
          options={labelsToOptions(ANOMALIE_ACTIVE_LABELS)}
          selected={value.anomaliesActives}
          onChange={(v) => onChange({ ...value, anomaliesActives: v as WorkflowTerrain['anomaliesActives'] })}
        />
      </SettingSection>
    </>
  );
}

// ===== Onglet Algorithmes & Temps =====

function AlgorithmesTab({ value, onChange }: { value: AlgorithmesContraintes; onChange: (v: AlgorithmesContraintes) => void }) {
  const ft = value.fenetresTemps;
  const ts = value.tempsService;
  const pr = value.pausesReglementation;

  const setFt = (patch: Partial<AlgorithmesContraintes['fenetresTemps']>) =>
    onChange({ ...value, fenetresTemps: { ...ft, ...patch } });
  const setTs = (patch: Partial<AlgorithmesContraintes['tempsService']>) =>
    onChange({ ...value, tempsService: { ...ts, ...patch } });
  const setPr = (patch: Partial<AlgorithmesContraintes['pausesReglementation']>) =>
    onChange({ ...value, pausesReglementation: { ...pr, ...patch } });

  return (
    <>
      <SettingSection title="Fenêtres de temps" description="Contraintes horaires pour les points de passage">
        <div className="space-y-3">
          <Toggle label="Créneaux stricts" description="Les créneaux doivent être respectés exactement" checked={ft.creneauxStricts} onChange={(v) => setFt({ creneauxStricts: v })} />
          <Toggle label="RDV heure fixe" description="Rendez-vous à une heure précise" checked={ft.rdvHeureFixe} onChange={(v) => setFt({ rdvHeureFixe: v })} />
          <Toggle label="Priorités VIP" description="Certains clients sont prioritaires" checked={ft.prioritesVip} onChange={(v) => setFt({ prioritesVip: v })} />
          <Toggle label="Demi-journée AM/PM" description="Planification par demi-journée" checked={ft.demiJourneeAmPm} onChange={(v) => setFt({ demiJourneeAmPm: v })} />
        </div>
      </SettingSection>

      <SettingSection title="Temps de service" description="Durées par défaut pour les opérations (en minutes)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberInput label="Temps fixe / arrêt" value={ts.tempsFixeArret} onChange={(v) => setTs({ tempsFixeArret: v })} unit="min" />
          <NumberInput label="Temps variable / unité" value={ts.tempsVariableUnite} onChange={(v) => setTs({ tempsVariableUnite: v })} unit="min" />
          <NumberInput label="Temps montage" value={ts.tempsMontage} onChange={(v) => setTs({ tempsMontage: v })} unit="min" />
          <NumberInput label="Temps administratif" value={ts.tempsAdministratif} onChange={(v) => setTs({ tempsAdministratif: v })} unit="min" />
        </div>
      </SettingSection>

      <SettingSection title="Pauses & Réglementation" description="Contraintes réglementaires et pauses">
        <div className="space-y-3">
          <Toggle label="Temps conduite max RSE (270 min)" description="Limite de conduite continue réglementaire" checked={pr.tempsConduiteMaxRse} onChange={(v) => setPr({ tempsConduiteMaxRse: v })} />
          <Toggle label="Pause déjeuner" checked={pr.pauseDejeuner} onChange={(v) => setPr({ pauseDejeuner: v })} />
          {pr.pauseDejeuner && (
            <div className="ml-6">
              <NumberInput label="Durée pause déjeuner" value={pr.pauseDejeunerDuree} onChange={(v) => setPr({ pauseDejeunerDuree: v })} unit="min" />
            </div>
          )}
          <Toggle label="ZFE actif" description="Zones à faibles émissions" checked={pr.zfeActif} onChange={(v) => setPr({ zfeActif: v })} />
          <Toggle label="Heures creuses/pointe" description="Adapter les horaires au trafic" checked={pr.heuresCreusesPointe} onChange={(v) => setPr({ heuresCreusesPointe: v })} />
          <Toggle label="Restrictions tonnage horaire" checked={pr.restrictionsTonnageHoraire} onChange={(v) => setPr({ restrictionsTonnageHoraire: v })} />
          <Toggle label="Interdictions weekend PL" checked={pr.interdictionsWeekendPl} onChange={(v) => setPr({ interdictionsWeekendPl: v })} />
        </div>
      </SettingSection>
    </>
  );
}

// ===== Onglet Interface & UI =====

function InterfaceTab({ value, onChange }: { value: InterfaceUi; onChange: (v: InterfaceUi) => void }) {
  const notif = value.notificationsClient;
  const setNotif = (patch: Partial<InterfaceUi['notificationsClient']>) =>
    onChange({ ...value, notificationsClient: { ...notif, ...patch } });

  const toggleChamp = (key: string) => {
    const updated = value.champsPersonnalises.map((c) =>
      c.key === key ? { ...c, actif: !c.actif } : c
    );
    onChange({ ...value, champsPersonnalises: updated });
  };

  const addChamp = () => {
    const newChamp: ChampPersonnalise = {
      key: `champ_${Date.now()}`,
      label: 'Nouveau champ',
      type: 'text',
      actif: true,
    };
    onChange({ ...value, champsPersonnalises: [...value.champsPersonnalises, newChamp] });
  };

  const updateChamp = (key: string, patch: Partial<ChampPersonnalise>) => {
    const updated = value.champsPersonnalises.map((c) =>
      c.key === key ? { ...c, ...patch } : c
    );
    onChange({ ...value, champsPersonnalises: updated });
  };

  const removeChamp = (key: string) => {
    onChange({ ...value, champsPersonnalises: value.champsPersonnalises.filter((c) => c.key !== key) });
  };

  return (
    <>
      <SettingSection title="Vues prioritaires" description="Vues disponibles dans l'interface admin">
        <MultiSelectCheckbox
          options={labelsToOptions(VUE_PRIORITAIRE_LABELS)}
          selected={value.vuesPrioritaires}
          onChange={(v) => onChange({ ...value, vuesPrioritaires: v as InterfaceUi['vuesPrioritaires'] })}
          columns={2}
        />
        {value.vuesPrioritaires.length > 0 && (
          <div className="mt-3">
            <label className="text-xs text-gray-500 mb-1 block">Vue principale</label>
            <select
              value={value.vuePrincipale}
              onChange={(e) => onChange({ ...value, vuePrincipale: e.target.value as InterfaceUi['vuePrincipale'] })}
              className="block w-full max-w-xs rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
            >
              <option value="">-- Sélectionner --</option>
              {value.vuesPrioritaires.map((v) => (
                <option key={v} value={v}>{VUE_PRIORITAIRE_LABELS[v]}</option>
              ))}
            </select>
          </div>
        )}
      </SettingSection>

      <SettingSection title="Champs personnalisés" description="Champs additionnels sur les points de passage">
        <div className="space-y-2">
          {value.champsPersonnalises.map((champ) => (
            <div key={champ.key} className="flex items-center gap-3 p-2 border border-gray-200 rounded-md">
              <input
                type="checkbox"
                checked={champ.actif}
                onChange={() => toggleChamp(champ.key)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
              />
              <input
                type="text"
                value={champ.label}
                onChange={(e) => updateChamp(champ.key, { label: e.target.value })}
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              />
              <select
                value={champ.type}
                onChange={(e) => updateChamp(champ.key, { type: e.target.value as ChampPersonnalise['type'] })}
                className="w-28 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
              >
                <option value="text">Texte</option>
                <option value="number">Nombre</option>
                <option value="select">Liste</option>
                <option value="boolean">Oui/Non</option>
              </select>
              <button
                onClick={() => removeChamp(champ.key)}
                className="text-red-500 hover:text-red-700 text-sm"
              >
                Supprimer
              </button>
            </div>
          ))}
          <button
            onClick={addChamp}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            + Ajouter un champ
          </button>
        </div>
      </SettingSection>

      <SettingSection title="Terminologie" description="Personnaliser les termes de l'interface">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextInput label="Tournée" value={value.terminologie.tournee} onChange={(v) => onChange({ ...value, terminologie: { ...value.terminologie, tournee: v } })} />
          <TextInput label="Chauffeur" value={value.terminologie.chauffeur} onChange={(v) => onChange({ ...value, terminologie: { ...value.terminologie, chauffeur: v } })} />
          <TextInput label="Point" value={value.terminologie.point} onChange={(v) => onChange({ ...value, terminologie: { ...value.terminologie, point: v } })} />
          <TextInput label="Véhicule" value={value.terminologie.vehicule} onChange={(v) => onChange({ ...value, terminologie: { ...value.terminologie, vehicule: v } })} />
        </div>
      </SettingSection>

      <SettingSection title="Notifications client" description="Notifications envoyées automatiquement aux clients">
        <div className="space-y-3">
          <Toggle label="SMS approche ETA" description="SMS avec heure d'arrivée estimée" checked={notif.smsApprocheEta} onChange={(v) => setNotif({ smsApprocheEta: v })} />
          <Toggle label="Lien tracking" description="Lien de suivi en temps réel" checked={notif.lienTracking} onChange={(v) => setNotif({ lienTracking: v })} />
          <Toggle label="Email confirmation" description="Email de confirmation de passage" checked={notif.emailConfirmation} onChange={(v) => setNotif({ emailConfirmation: v })} />
          <Toggle label="Enquête satisfaction" description="Enquête post-intervention" checked={notif.enqueteSatisfaction} onChange={(v) => setNotif({ enqueteSatisfaction: v })} />
          <Toggle label="Notification retard" description="Alerte en cas de retard" checked={notif.notificationRetard} onChange={(v) => setNotif({ notificationRetard: v })} />
        </div>
      </SettingSection>
    </>
  );
}

// ===== Composants utilitaires =====

function NumberInput({ label, value, onChange, unit }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
        />
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
      />
    </div>
  );
}

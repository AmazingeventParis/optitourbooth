import { useState, useEffect, useRef } from 'react';
import { Card, Button, Modal, Input, Badge } from '@/components/ui';
import { machinesService } from '@/services/machines.service';
import { preparationsService } from '@/services/preparations.service';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/store/authStore';
import { Machine, MachineType, Preparation, PreparationStatut } from '@/types';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  CheckCircleIcon,
  PhotoIcon,
  WrenchScrewdriverIcon,
  ArchiveBoxIcon,
  ArrowLeftIcon,
  CameraIcon,
  CpuChipIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const machineTypeBaseConfig: Record<MachineType, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
}> = {
  Vegas: {
    label: 'Vegas',
    icon: CameraIcon,
    count: 35,
  },
  Smakk: {
    label: 'Smakk',
    icon: CpuChipIcon,
    count: 20,
  },
  Ring: {
    label: 'Ring',
    icon: WrenchScrewdriverIcon,
    count: 10,
  },
};

// Fonction pour convertir hex en RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

const statutConfig: Record<PreparationStatut, { label: string; color: string; badge: string }> = {
  disponible: { label: 'Disponible', color: 'bg-blue-50 border-blue-400 hover:border-blue-500', badge: 'info' },
  en_preparation: { label: 'En préparation', color: 'bg-orange-50 border-orange-400 hover:border-orange-500', badge: 'warning' },
  prete: { label: 'Prête', color: 'bg-green-50 border-green-500 hover:border-green-600', badge: 'success' },
  en_cours: { label: 'En cours', color: 'bg-purple-50 border-purple-400 hover:border-purple-500', badge: 'info' },
  a_decharger: { label: 'À décharger', color: 'bg-yellow-50 border-yellow-400 hover:border-yellow-500', badge: 'warning' },
  hors_service: { label: 'Hors service', color: 'bg-red-50 border-red-500 hover:border-red-600', badge: 'danger' },
  archivee: { label: 'Archivée', color: 'bg-gray-100 border-gray-300', badge: 'default' },
};

export default function PreparationsPage() {
  const { success, error: showError } = useToast();
  const { user } = useAuthStore();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedType, setSelectedType] = useState<MachineType | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [archivedPreparations, setArchivedPreparations] = useState<Preparation[]>([]);
  const [archiveTypeFilter, setArchiveTypeFilter] = useState<MachineType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state - Liste d'événements à créer
  const [evenements, setEvenements] = useState<Array<{ dateEvenement: string; client: string }>>([
    { dateEvenement: '', client: '' }
  ]);

  // Action modal state
  const [isViewMode, setIsViewMode] = useState(false);
  const [defautText, setDefautText] = useState('');
  const [horsServiceText, setHorsServiceText] = useState('');

  useEffect(() => {
    fetchMachines();
  }, []);

  const fetchMachines = async () => {
    setIsLoading(true);
    try {
      const data = await machinesService.list({ actif: true });
      setMachines(data);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchArchive = async () => {
    try {
      const { data } = await preparationsService.list({ archived: true, limit: 100 });
      setArchivedPreparations(data);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    }
  };

  const handleOpenModal = (machine: Machine) => {
    setSelectedMachine(machine);
    const preparation = getPreparationForMachine(machine);

    if (preparation) {
      // Mode visualisation
      setIsViewMode(true);
    } else {
      // Mode création
      setIsViewMode(false);
      setEvenements([{ dateEvenement: '', client: '' }]);
    }

    setDefautText('');
    setHorsServiceText('');
    setIsModalOpen(true);
  };

  const handleCreatePreparation = async () => {
    if (!selectedMachine) {
      showError('Erreur', 'Machine non sélectionnée');
      return;
    }

    if (!user) {
      showError('Erreur', 'Utilisateur non connecté');
      return;
    }

    // Vérifier que tous les événements ont date et client
    const evenementsValides = evenements.filter(e => e.dateEvenement && e.client);
    if (evenementsValides.length === 0) {
      showError('Erreur', 'Veuillez remplir au moins une date et un client');
      return;
    }

    setIsSaving(true);
    try {
      // Prénom du préparateur connecté
      const preparateur = user.prenom;

      // Créer toutes les préparations
      for (const evt of evenementsValides) {
        await preparationsService.create({
          machineId: selectedMachine.id,
          dateEvenement: evt.dateEvenement,
          client: evt.client,
          preparateur,
          notes: undefined,
        });
      }

      success(`${evenementsValides.length} préparation(s) créée(s)`);

      // Réinitialiser pour permettre d'en créer d'autres
      setEvenements([{ dateEvenement: '', client: '' }]);
      setDefautText('');
      setHorsServiceText('');

      // Fermer le modal
      setIsModalOpen(false);

      // Rafraîchir les machines (déclenchera l'auto-transition côté backend)
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkAsReady = async (preparationId: string) => {
    setIsSaving(true);
    try {
      await preparationsService.markAsReady(preparationId);
      success('Machine marquée comme prête');
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkPhotosUnloaded = async (preparationId: string) => {
    setIsSaving(true);
    try {
      await preparationsService.markPhotosUnloaded(preparationId);
      success('Photos déchargées et événement archivé');
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelPreparation = async (preparationId: string) => {
    setIsSaving(true);
    try {
      await preparationsService.delete(preparationId);
      success('Préparation annulée — borne remise disponible');
      setIsModalOpen(false);
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // handleUpdateStatut supprimé - transitions automatiques maintenant
  // const handleUpdateStatut = async (preparationId: string, newStatut: PreparationStatut) => {
  //   setIsSaving(true);
  //   try {
  //     await preparationsService.update(preparationId, { statut: newStatut });
  //     success('Statut mis à jour');
  //     fetchMachines();
  //   } catch (err) {
  //     showError('Erreur', (err as Error).message);
  //   } finally {
  //     setIsSaving(false);
  //   }
  // };

  const handleMarkDefect = async (machineId: string) => {
    if (!defautText.trim()) {
      showError('Erreur', 'Veuillez décrire le défaut');
      return;
    }

    setIsSaving(true);
    try {
      await machinesService.markDefect(machineId, defautText);
      success('Défaut signalé');
      setIsModalOpen(false);
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkOutOfService = async (machineId: string) => {
    if (!horsServiceText.trim()) {
      showError('Erreur', 'Veuillez indiquer la raison');
      return;
    }

    setIsSaving(true);
    try {
      await machinesService.markOutOfService(machineId, horsServiceText);
      success('Machine marquée hors service');
      setIsModalOpen(false);
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearDefect = async (machineId: string) => {
    setIsSaving(true);
    try {
      await machinesService.clearDefect(machineId);
      success('Défaut retiré');
      setIsModalOpen(false);
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreToService = async (machineId: string) => {
    setIsSaving(true);
    try {
      await machinesService.restoreToService(machineId);
      success('Machine remise en service');
      setIsModalOpen(false);
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !selectedType) return;

    const file = e.target.files[0];
    setIsUploadingImage(true);

    try {
      const result = await machinesService.uploadImage(selectedType, file);
      success(result.message);
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAddNewEvent = () => {
    // Ajouter un nouvel événement à la liste
    setEvenements([...evenements, { dateEvenement: '', client: '' }]);
  };

  const getPreparationForMachine = (machine: Machine): Preparation | undefined => {
    return machine.preparations && machine.preparations.length > 0
      ? machine.preparations[0]
      : undefined;
  };

  const getMachineStatut = (machine: Machine): PreparationStatut => {
    const prep = getPreparationForMachine(machine);
    return prep?.statut || 'disponible';
  };

  const filteredMachines = selectedType
    ? machines
        .filter((m) => m.type === selectedType)
        .sort((a, b) => {
          // Extraire le numéro de la chaîne (ex: "V1" -> 1, "SK10" -> 10)
          const numA = parseInt(a.numero.replace(/\D/g, ''), 10) || 0;
          const numB = parseInt(b.numero.replace(/\D/g, ''), 10) || 0;
          return numA - numB;
        })
    : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  // Mode Archive
  if (isArchiveMode) {
    // Filtrer les préparations archivées
    const filteredArchive = archivedPreparations.filter(prep => {
      // Filtre par type de borne
      if (archiveTypeFilter !== 'all' && prep.machine?.type !== archiveTypeFilter) {
        return false;
      }

      // Filtre par recherche (numéro de borne ou nom de client)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const numero = prep.machine?.numero?.toLowerCase() || '';
        const client = prep.client.toLowerCase();

        if (!numero.includes(query) && !client.includes(query)) {
          return false;
        }
      }

      return true;
    });

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Archive des événements</h1>
          <Button variant="secondary" onClick={() => {
            setIsArchiveMode(false);
            setArchiveTypeFilter('all');
            setSearchQuery('');
            fetchMachines();
          }}>
            <ArrowLeftIcon className="h-5 w-5 mr-2" />
            Retour
          </Button>
        </div>

        {/* Filtres */}
        <Card className="p-4">
          <div className="space-y-4">
            {/* Recherche intelligente */}
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher par numéro de borne ou nom de client..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Filtres par type de borne */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setArchiveTypeFilter('all')}
                className={clsx(
                  'px-4 py-2 rounded-lg font-medium transition-all',
                  archiveTypeFilter === 'all'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                Toutes ({archivedPreparations.length})
              </button>
              {Object.entries(machineTypeBaseConfig).map(([type, config]) => {
                const count = archivedPreparations.filter(p => p.machine?.type === type).length;
                return (
                  <button
                    key={type}
                    onClick={() => setArchiveTypeFilter(type as MachineType)}
                    className={clsx(
                      'px-4 py-2 rounded-lg font-medium transition-all',
                      archiveTypeFilter === type
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {config.label} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Résultats */}
        <Card className="p-6">
          {filteredArchive.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              {searchQuery || archiveTypeFilter !== 'all'
                ? 'Aucun résultat pour ces critères'
                : 'Aucun événement archivé'}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredArchive.map((prep) => (
                <div key={prep.id} className="p-4 border border-gray-200 rounded-lg hover:shadow-sm transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{prep.client}</p>
                      <p className="text-sm text-gray-600">
                        {prep.machine?.type} {prep.machine?.numero} • {format(parseISO(prep.dateEvenement), 'd MMMM yyyy', { locale: fr })}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Préparateur: {prep.preparateur?.split(' ')[0]}</p>
                    </div>
                    {prep.photosDechargees ? (
                      <Badge variant="success">
                        Photos déchargées
                      </Badge>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            await preparationsService.markPhotosUnloaded(prep.id);
                            success('Photos marquées comme déchargées');
                            fetchArchive();
                          } catch (err) {
                            showError('Erreur', (err as Error).message);
                          }
                        }}
                        className="px-3 py-1.5 bg-red-500 text-white text-sm font-medium rounded-full hover:bg-red-600 active:scale-95 transition-all shadow-sm"
                      >
                        Photos non déchargées
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Résumé des résultats */}
        {(searchQuery || archiveTypeFilter !== 'all') && (
          <p className="text-sm text-gray-500 text-center">
            {filteredArchive.length} résultat{filteredArchive.length > 1 ? 's' : ''} sur {archivedPreparations.length} événement{archivedPreparations.length > 1 ? 's' : ''}
          </p>
        )}
      </div>
    );
  }

  // Vue de sélection du type (pas de type sélectionné)
  if (!selectedType) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Gestion des Préparations</h1>
          <Button variant="secondary" onClick={() => {
            setIsArchiveMode(true);
            fetchArchive();
          }}>
            <ArchiveBoxIcon className="h-5 w-5 mr-2" />
            Archive
          </Button>
        </div>

        <div className="text-center mb-8">
          <p className="text-gray-600">Sélectionnez un type de machine pour gérer les préparations</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {Object.entries(machineTypeBaseConfig).map(([type, config]) => {
            const Icon = config.icon;
            const machinesOfType = machines.filter((m) => m.type === type);
            const disponibles = machinesOfType.filter((m) => getMachineStatut(m) === 'disponible').length;
            const pretes = machinesOfType.filter((m) => getMachineStatut(m) === 'prete').length;
            const aDecharger = machinesOfType.filter((m) => getMachineStatut(m) === 'a_decharger').length;
            const horsService = machinesOfType.filter((m) => getMachineStatut(m) === 'hors_service').length;

            // Récupérer la couleur d'une machine de ce type
            const machineColor = machinesOfType[0]?.couleur || '#3B82F6';
            const rgb = hexToRgb(machineColor);

            return (
              <button
                key={type}
                onClick={() => setSelectedType(type as MachineType)}
                className="group relative overflow-hidden rounded-xl border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
                style={{
                  backgroundColor: 'white',
                  borderColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)` : '#E5E7EB',
                }}
              >
                {/* Accent bar */}
                <div
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{ backgroundColor: machineColor }}
                />

                <div className="relative p-4">
                  {/* Header compact */}
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={clsx(
                        "rounded-lg overflow-hidden flex items-center justify-center",
                        machinesOfType[0]?.imageUrl ? "w-10 h-10" : "w-10 h-10 p-2"
                      )}
                      style={{
                        backgroundColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)` : undefined,
                        color: machineColor,
                      }}
                    >
                      {machinesOfType[0]?.imageUrl ? (
                        <img
                          src={machinesOfType[0].imageUrl}
                          alt={config.label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Icon className="w-full h-full" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className="text-lg font-bold" style={{ color: machineColor }}>
                        {config.label}
                      </h3>
                      <p className="text-xs text-gray-500">{config.count} machines</p>
                    </div>
                  </div>

                  {/* Stats grid compact */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5">
                      <span className="text-gray-600">Dispo</span>
                      <span className="font-bold text-blue-600">{disponibles}</span>
                    </div>
                    <div className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5">
                      <span className="text-gray-600">Prêtes</span>
                      <span className="font-bold text-green-600">{pretes}</span>
                    </div>
                    <div className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5">
                      <span className="text-gray-600">Déch.</span>
                      <span className="font-bold text-yellow-600">{aDecharger}</span>
                    </div>
                    <div className="flex items-center justify-between bg-gray-50 rounded px-2 py-1.5">
                      <span className="text-gray-600">H.S.</span>
                      <span className="font-bold text-red-600">{horsService}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Vue des machines du type sélectionné
  const typeConfig = machineTypeBaseConfig[selectedType];
  const Icon = typeConfig.icon;
  const machineColor = filteredMachines[0]?.couleur || '#3B82F6';
  const rgb = hexToRgb(machineColor);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setSelectedType(null)}>
            <ArrowLeftIcon className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                "rounded-lg border-2 relative group cursor-pointer overflow-hidden",
                filteredMachines[0]?.imageUrl ? "w-12 h-12" : "w-12 h-12 p-3"
              )}
              style={{
                backgroundColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)` : undefined,
                borderColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)` : undefined,
                color: machineColor,
              }}
              onClick={() => fileInputRef.current?.click()}
              title="Cliquer pour changer l'image"
            >
              {filteredMachines[0]?.imageUrl ? (
                <>
                  <img
                    src={filteredMachines[0].imageUrl}
                    alt={typeConfig.label}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <CameraIcon className="h-4 w-4 text-white" />
                  </div>
                </>
              ) : (
                <>
                  <Icon className="w-full h-full" />
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <CameraIcon className="h-4 w-4 text-white" />
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
              disabled={isUploadingImage}
            />
            <div>
              <h1
                className="text-2xl font-bold"
                style={{ color: machineColor }}
              >
                {typeConfig.label}
              </h1>
              <p className="text-sm text-gray-500">{filteredMachines.length} machines</p>
            </div>
          </div>
        </div>
        <Button variant="secondary" onClick={() => {
          setIsArchiveMode(true);
          fetchArchive();
        }}>
          <ArchiveBoxIcon className="h-5 w-5 mr-2" />
          Archive
        </Button>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
        {filteredMachines.map((machine) => {
          const statut = getMachineStatut(machine);
          const preparation = getPreparationForMachine(machine);
          const statutInfo = statutConfig[statut];

          return (
            <button
              key={machine.id}
              className={clsx(
                'relative p-2.5 border rounded-lg transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5',
                'bg-white',
                statut === 'disponible' && 'border-gray-200 hover:border-blue-300',
                statut === 'en_preparation' && 'border-orange-300 hover:border-orange-400',
                statut === 'prete' && 'border-green-400 hover:border-green-500 shadow-sm',
                statut === 'en_cours' && 'border-purple-300 hover:border-purple-400',
                statut === 'a_decharger' && 'border-yellow-400 hover:border-yellow-500',
                statut === 'hors_service' && 'border-red-400 hover:border-red-500'
              )}
              onClick={() => handleOpenModal(machine)}
            >
              {/* Barre de couleur statut */}
              <div
                className={clsx(
                  'absolute top-0 left-0 right-0 h-0.5 rounded-t-lg',
                  statut === 'disponible' && 'bg-blue-400',
                  statut === 'en_preparation' && 'bg-orange-400',
                  statut === 'prete' && 'bg-green-500',
                  statut === 'en_cours' && 'bg-purple-400',
                  statut === 'a_decharger' && 'bg-yellow-500',
                  statut === 'hors_service' && 'bg-red-500'
                )}
              />

              {/* Numéro de machine */}
              <div className="text-center mb-1.5">
                <div className="flex items-center justify-center gap-1">
                  <span className="font-bold text-xl text-gray-900">{machine.numero}</span>
                  {machine.aDefaut && (
                    <WrenchScrewdriverIcon className="h-3 w-3 text-orange-500 animate-pulse" title={machine.defaut || 'Défaut signalé'} />
                  )}
                </div>
              </div>

              {/* Badge statut compact */}
              <div className="flex justify-center mb-1.5">
                <span
                  className={clsx(
                    'text-[9px] font-semibold px-1.5 py-0.5 rounded text-center leading-tight',
                    statut === 'disponible' && 'bg-blue-50 text-blue-700',
                    statut === 'en_preparation' && 'bg-orange-50 text-orange-700',
                    statut === 'prete' && 'bg-green-50 text-green-700',
                    statut === 'en_cours' && 'bg-purple-50 text-purple-700',
                    statut === 'a_decharger' && 'bg-yellow-50 text-yellow-700',
                    statut === 'hors_service' && 'bg-red-50 text-red-700'
                  )}
                >
                  {statut === 'prete' && preparation
                    ? `préparée par ${preparation.preparateur?.split(' ')[0] || '?'}`
                    : statutInfo.label}
                </span>
              </div>

              {/* Infos préparation */}
              {preparation && (
                <div className="space-y-1">
                  <div className="pt-1.5 border-t border-gray-100">
                    <p className="text-[10px] font-bold text-gray-800 truncate leading-tight" title={preparation.client}>
                      {preparation.client}
                    </p>
                    <p className="text-[9px] text-gray-500 mt-0.5">
                      {format(parseISO(preparation.dateEvenement), 'd MMM', { locale: fr })}
                    </p>
                  </div>

                  {/* Actions rapides */}
                  <div className="flex gap-1">
                    {statut === 'en_preparation' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkAsReady(preparation.id);
                        }}
                        className="flex-1 p-1 bg-green-500 text-white rounded hover:bg-green-600 active:scale-95 transition-all disabled:opacity-50"
                        title="Marquer comme prête"
                        disabled={isSaving}
                      >
                        <CheckCircleIcon className="h-3 w-3 mx-auto" />
                      </button>
                    )}
                    {statut === 'a_decharger' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkPhotosUnloaded(preparation.id);
                        }}
                        className="flex-1 p-1 bg-blue-500 text-white rounded hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50"
                        title="Marquer photos déchargées"
                        disabled={isSaving}
                      >
                        <PhotoIcon className="h-3 w-3 mx-auto" />
                      </button>
                    )}
                    {/* Boutons manuels supprimés - transitions automatiques */}
                    {/* - "prete" → "en_cours" : automatique le jour de l'événement */}
                    {/* - "en_cours" → "a_decharger" : automatique le lendemain du dernier événement */}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Modal Préparation */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${isViewMode ? '' : 'Préparer '}${selectedMachine?.type} ${selectedMachine?.numero}`}
      >
        <div className="space-y-4">
          {/* Section événements */}
          {!isViewMode ? (
            <>
              {/* Bouton Ajouter un événement */}
              <div className="pb-4 border-b border-gray-200">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleAddNewEvent}
                >
                  + Ajouter un événement
                </Button>
              </div>

              {/* Liste des événements */}
              {evenements.map((evt, index) => (
                <div key={index} className="space-y-3 p-4 bg-gray-50 rounded-lg relative">
                  {evenements.length > 1 && (
                    <button
                      onClick={() => setEvenements(evenements.filter((_, i) => i !== index))}
                      className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                      type="button"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  )}
                  <Input
                    label="Date de l'événement"
                    type="date"
                    value={evt.dateEvenement}
                    onChange={(e) => {
                      const newEvents = [...evenements];
                      newEvents[index].dateEvenement = e.target.value;
                      setEvenements(newEvents);
                    }}
                    required
                  />
                  <Input
                    label="Nom du client"
                    value={evt.client}
                    onChange={(e) => {
                      const newEvents = [...evenements];
                      newEvents[index].client = e.target.value;
                      setEvenements(newEvents);
                    }}
                    placeholder="Nom de l'événement ou du client"
                    required
                  />
                </div>
              ))}
            </>
          ) : (
            <>
              {/* Affichage en mode visualisation */}
              {(() => {
                const prep = getPreparationForMachine(selectedMachine!);
                if (!prep) return null;
                return (
                  <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Date de l'événement</label>
                      <p className="text-sm text-gray-900">{new Date(prep.dateEvenement).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                      <p className="text-sm text-gray-900">{prep.client}</p>
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* Boutons d'action - Toujours visibles */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            {/* Annuler la préparation (statut prête uniquement) */}
            {isViewMode && selectedMachine && getMachineStatut(selectedMachine) === 'prete' && (
              <div>
                {(() => {
                  const prep = getPreparationForMachine(selectedMachine!);
                  if (!prep) return null;
                  return (
                    <Button
                      variant="danger"
                      className="w-full"
                      onClick={() => handleCancelPreparation(prep.id)}
                      disabled={isSaving}
                      isLoading={isSaving}
                    >
                      <XMarkIcon className="h-5 w-5 mr-2" />
                      Annuler la préparation
                    </Button>
                  );
                })()}
              </div>
            )}

            {/* Photos déchargées */}
            {isViewMode && (
              <div>
                {(() => {
                  const prep = getPreparationForMachine(selectedMachine!);
                  if (!prep) return null;
                  const isPastDate = new Date(prep.dateEvenement) < new Date();
                  return (
                    <>
                      <Button
                        variant={isPastDate ? 'primary' : 'secondary'}
                        className="w-full"
                        onClick={() => handleMarkPhotosUnloaded(prep.id)}
                        disabled={!isPastDate || isSaving}
                        isLoading={isSaving}
                      >
                        <CheckCircleIcon className="h-5 w-5 mr-2" />
                        Photos déchargées
                      </Button>
                      <p className="text-xs text-gray-500 mt-1">
                        {isPastDate
                          ? 'Marquer les photos comme déchargées et archiver'
                          : 'Disponible après la date de l\'événement'}
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Champ partagé pour défaut/hors service */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Préciser la panne</label>
              <textarea
                value={selectedMachine?.aDefaut ? selectedMachine.defaut || '' : (defautText || horsServiceText)}
                onChange={(e) => {
                  const value = e.target.value;
                  setDefautText(value);
                  setHorsServiceText(value);
                }}
                rows={2}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-2"
                placeholder="Décrire la panne..."
                disabled={Boolean(selectedMachine?.aDefaut || (selectedMachine && getMachineStatut(selectedMachine) === 'hors_service'))}
              />

              {/* Boutons d'action - côte à côte */}
              {selectedMachine?.aDefaut ? (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => {
                    if (selectedMachine) handleClearDefect(selectedMachine.id);
                  }}
                  disabled={isSaving}
                  isLoading={isSaving}
                >
                  <CheckCircleIcon className="h-5 w-5 mr-2" />
                  Retirer le défaut
                </Button>
              ) : selectedMachine && getMachineStatut(selectedMachine) === 'hors_service' ? (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => {
                    if (selectedMachine) handleRestoreToService(selectedMachine.id);
                  }}
                  disabled={isSaving}
                  isLoading={isSaving}
                >
                  <CheckCircleIcon className="h-5 w-5 mr-2" />
                  Remettre en service
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="warning"
                    className="flex-1"
                    onClick={() => {
                      if (selectedMachine) handleMarkDefect(selectedMachine.id);
                    }}
                    disabled={isSaving || !defautText}
                    isLoading={isSaving}
                  >
                    <WrenchScrewdriverIcon className="h-5 w-5 mr-2" />
                    Signaler un défaut
                  </Button>
                  <Button
                    variant="danger"
                    className="flex-1"
                    onClick={() => {
                      if (selectedMachine) handleMarkOutOfService(selectedMachine.id);
                    }}
                    disabled={isSaving || !horsServiceText}
                    isLoading={isSaving}
                  >
                    Mettre hors service
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => setIsModalOpen(false)}>
              Fermer
            </Button>
            {!isViewMode && (
              <Button className="flex-1" onClick={handleCreatePreparation} isLoading={isSaving}>
                Créer
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

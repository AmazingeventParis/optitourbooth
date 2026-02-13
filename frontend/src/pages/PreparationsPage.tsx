import { useState, useEffect, useRef } from 'react';
import { Card, Button, Modal, Input, Badge } from '@/components/ui';
import { machinesService } from '@/services/machines.service';
import { preparationsService } from '@/services/preparations.service';
import { useToast } from '@/hooks/useToast';
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
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedType, setSelectedType] = useState<MachineType | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [archivedPreparations, setArchivedPreparations] = useState<Preparation[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [formData, setFormData] = useState({
    dateEvenement: '',
    client: '',
    preparateur: '',
    notes: '',
  });

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
      setFormData({
        dateEvenement: preparation.dateEvenement.split('T')[0],
        client: preparation.client,
        preparateur: preparation.preparateur,
        notes: preparation.notes || '',
      });
    } else {
      // Mode création
      setIsViewMode(false);
      setFormData({
        dateEvenement: '',
        client: '',
        preparateur: '',
        notes: '',
      });
    }

    setDefautText('');
    setHorsServiceText('');
    setIsModalOpen(true);
  };

  const handleCreatePreparation = async () => {
    if (!selectedMachine || !formData.dateEvenement || !formData.client || !formData.preparateur) {
      showError('Erreur', 'Veuillez remplir tous les champs obligatoires');
      return;
    }

    setIsSaving(true);
    try {
      await preparationsService.create({
        machineId: selectedMachine.id,
        dateEvenement: formData.dateEvenement,
        client: formData.client,
        preparateur: formData.preparateur,
        notes: formData.notes || undefined,
      });
      success('Préparation créée');

      // Réinitialiser le formulaire pour permettre d'en créer une autre
      setFormData({
        dateEvenement: '',
        client: '',
        preparateur: '',
        notes: '',
      });
      setDefautText('');
      setHorsServiceText('');

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

  const handleUpdateStatut = async (preparationId: string, newStatut: PreparationStatut) => {
    setIsSaving(true);
    try {
      await preparationsService.update(preparationId, { statut: newStatut });
      success('Statut mis à jour');
      fetchMachines();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

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
    // Passer en mode création tout en gardant la machine sélectionnée
    setIsViewMode(false);
    setFormData({
      dateEvenement: '',
      client: '',
      preparateur: '',
      notes: '',
    });
    setDefautText('');
    setHorsServiceText('');
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
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Archive des événements</h1>
          <Button variant="secondary" onClick={() => {
            setIsArchiveMode(false);
            fetchMachines();
          }}>
            <ArrowLeftIcon className="h-5 w-5 mr-2" />
            Retour
          </Button>
        </div>

        <Card className="p-6">
          {archivedPreparations.length === 0 ? (
            <p className="text-center text-gray-500 py-8">Aucun événement archivé</p>
          ) : (
            <div className="space-y-2">
              {archivedPreparations.map((prep) => (
                <div key={prep.id} className="p-4 border border-gray-200 rounded-lg hover:shadow-sm transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{prep.client}</p>
                      <p className="text-sm text-gray-600">
                        {prep.machine?.type} {prep.machine?.numero} • {format(parseISO(prep.dateEvenement), 'd MMMM yyyy', { locale: fr })}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Préparateur: {prep.preparateur}</p>
                    </div>
                    <Badge variant={prep.photosDechargees ? 'success' : 'danger'}>
                      {prep.photosDechargees ? 'Photos déchargées' : 'Photos non déchargées'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
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
                className="group relative overflow-hidden rounded-2xl border-2 transition-all duration-300 hover:scale-105 hover:shadow-2xl transform"
                style={{
                  backgroundColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)` : undefined,
                  borderColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)` : undefined,
                }}
                onMouseEnter={(e) => {
                  if (rgb) {
                    e.currentTarget.style.borderColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`;
                    e.currentTarget.style.boxShadow = `0 20px 40px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (rgb) {
                    e.currentTarget.style.borderColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`;
                    e.currentTarget.style.boxShadow = '';
                  }
                }}
              >
                {/* Gradient overlay */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300"
                  style={{
                    background: rgb ? `linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3) 0%, transparent 100%)` : undefined,
                  }}
                />

                <div className="relative p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div
                      className="p-3 rounded-xl bg-white shadow-md transform group-hover:scale-110 transition-transform duration-300"
                      style={{
                        borderWidth: '2px',
                        borderColor: rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)` : undefined,
                        color: machineColor,
                      }}
                    >
                      {machinesOfType[0]?.imageUrl ? (
                        <img
                          src={machinesOfType[0].imageUrl}
                          alt={config.label}
                          className="h-8 w-8 object-contain"
                        />
                      ) : (
                        <Icon className="h-8 w-8" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <h3
                        className="text-2xl font-bold tracking-tight"
                        style={{ color: machineColor }}
                      >
                        {config.label}
                      </h3>
                      <p className="text-sm text-gray-500 font-medium">{config.count} machines</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center bg-blue-50 border border-blue-300 rounded-lg px-3 py-2 shadow-sm">
                      <span className="text-blue-700 font-semibold">Disponibles</span>
                      <span className="font-bold text-blue-900 text-base">{disponibles}</span>
                    </div>
                    <div className="flex justify-between items-center bg-green-50 border border-green-300 rounded-lg px-3 py-2 shadow-sm">
                      <span className="text-green-700 font-semibold">Prêtes</span>
                      <span className="font-bold text-green-900 text-base">{pretes}</span>
                    </div>
                    <div className="flex justify-between items-center bg-yellow-50 border border-yellow-300 rounded-lg px-3 py-2 shadow-sm">
                      <span className="text-yellow-700 font-semibold">À décharger</span>
                      <span className="font-bold text-yellow-900 text-base">{aDecharger}</span>
                    </div>
                    <div className="flex justify-between items-center bg-red-50 border border-red-300 rounded-lg px-3 py-2 shadow-sm">
                      <span className="text-red-700 font-semibold">Hors service</span>
                      <span className="font-bold text-red-900 text-base">{horsService}</span>
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
              className="p-3 rounded-lg border-2 relative group cursor-pointer"
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
                    className="h-6 w-6 object-contain"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                    <CameraIcon className="h-4 w-4 text-white" />
                  </div>
                </>
              ) : (
                <>
                  <Icon className="h-6 w-6" />
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {filteredMachines.map((machine) => {
          const statut = getMachineStatut(machine);
          const preparation = getPreparationForMachine(machine);
          const statutInfo = statutConfig[statut];

          return (
            <div
              key={machine.id}
              className={clsx(
                'relative p-3 border-2 rounded-xl transition-all duration-300 cursor-pointer transform hover:scale-105 hover:shadow-xl',
                statutInfo.color
              )}
              onClick={() => handleOpenModal(machine)}
            >
              {/* Numéro de machine */}
              <div className="text-center mb-2">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="font-bold text-2xl tracking-tight text-gray-900">{machine.numero}</span>
                  {machine.aDefaut && (
                    <WrenchScrewdriverIcon className="h-4 w-4 text-orange-500 animate-pulse" title={machine.defaut || 'Défaut signalé'} />
                  )}
                </div>
              </div>

              {/* Badge statut */}
              <div className="flex justify-center mb-2">
                <Badge variant={statutInfo.badge as any}>
                  <span className="text-[10px] font-semibold">{statutInfo.label}</span>
                </Badge>
              </div>

              {/* Infos préparation */}
              {preparation && (
                <div className="space-y-1.5">
                  <div className="pt-2 border-t border-gray-200">
                    <p className="text-[11px] font-bold text-gray-800 truncate leading-tight" title={preparation.client}>
                      {preparation.client}
                    </p>
                    <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                      {format(parseISO(preparation.dateEvenement), 'd MMM', { locale: fr })}
                    </p>
                  </div>

                  {/* Actions rapides */}
                  <div className="flex gap-1.5">
                    {statut === 'en_preparation' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkAsReady(preparation.id);
                        }}
                        className="flex-1 p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 active:scale-95 transition-all shadow-sm disabled:opacity-50"
                        title="Marquer comme prête"
                        disabled={isSaving}
                      >
                        <CheckCircleIcon className="h-3.5 w-3.5 mx-auto" />
                      </button>
                    )}
                    {statut === 'a_decharger' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkPhotosUnloaded(preparation.id);
                        }}
                        className="flex-1 p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:scale-95 transition-all shadow-sm disabled:opacity-50"
                        title="Marquer photos déchargées"
                        disabled={isSaving}
                      >
                        <PhotoIcon className="h-3.5 w-3.5 mx-auto" />
                      </button>
                    )}
                    {statut === 'prete' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateStatut(preparation.id, 'en_cours');
                        }}
                        className="flex-1 p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:scale-95 transition-all shadow-sm disabled:opacity-50"
                        title="Démarrer événement"
                        disabled={isSaving}
                      >
                        <WrenchScrewdriverIcon className="h-4 w-4 mx-auto" />
                      </button>
                    )}
                    {statut === 'en_cours' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateStatut(preparation.id, 'a_decharger');
                        }}
                        className="flex-1 p-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors disabled:opacity-50"
                        title="Retour - À décharger"
                        disabled={isSaving}
                      >
                        <PhotoIcon className="h-4 w-4 mx-auto" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
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
          {/* Bouton Ajouter un événement - toujours visible */}
          <div className="pb-4 border-b border-gray-200">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleAddNewEvent}
            >
              + Ajouter un événement
            </Button>
          </div>

          <Input
            label="Date de l'événement"
            type="date"
            value={formData.dateEvenement}
            onChange={(e) => setFormData({ ...formData, dateEvenement: e.target.value })}
            required
            disabled={isViewMode}
          />
          <Input
            label="Nom du client"
            value={formData.client}
            onChange={(e) => setFormData({ ...formData, client: e.target.value })}
            placeholder="Nom de l'événement ou du client"
            required
            disabled={isViewMode}
          />
          <Input
            label="Préparateur"
            value={formData.preparateur}
            onChange={(e) => setFormData({ ...formData, preparateur: e.target.value })}
            placeholder="Nom du préparateur"
            required
            disabled={isViewMode}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Notes optionnelles..."
              disabled={isViewMode}
            />
          </div>

          {/* Boutons d'action - Toujours visibles */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            {/* Photos déchargées */}
            <div>
              <Button
                variant={new Date(formData.dateEvenement) < new Date() && isViewMode ? 'primary' : 'secondary'}
                className="w-full"
                onClick={() => {
                  const prep = getPreparationForMachine(selectedMachine!);
                  if (prep) handleMarkPhotosUnloaded(prep.id);
                }}
                disabled={!isViewMode || new Date(formData.dateEvenement) >= new Date() || isSaving}
                isLoading={isSaving}
              >
                <CheckCircleIcon className="h-5 w-5 mr-2" />
                Photos déchargées
              </Button>
              <p className="text-xs text-gray-500 mt-1">
                {!isViewMode
                  ? 'Créez d\'abord la préparation'
                  : new Date(formData.dateEvenement) >= new Date()
                  ? 'Disponible après la date de l\'événement'
                  : 'Marquer les photos comme déchargées et archiver'}
              </p>
            </div>

            {/* Défaut */}
            <div>
              {selectedMachine?.aDefaut ? (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Défaut signalé</label>
                  <div className="p-3 mb-2 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-sm text-orange-900">{selectedMachine.defaut}</p>
                  </div>
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
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Signaler un défaut</label>
                  <textarea
                    value={defautText}
                    onChange={(e) => setDefautText(e.target.value)}
                    rows={2}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-2"
                    placeholder="Décrire le défaut..."
                  />
                  <Button
                    variant="warning"
                    className="w-full"
                    onClick={() => {
                      if (selectedMachine) handleMarkDefect(selectedMachine.id);
                    }}
                    disabled={isSaving}
                    isLoading={isSaving}
                  >
                    <WrenchScrewdriverIcon className="h-5 w-5 mr-2" />
                    Signaler un défaut
                  </Button>
                </>
              )}
            </div>

            {/* Hors service */}
            <div>
              {selectedMachine && getMachineStatut(selectedMachine) === 'hors_service' ? (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Machine hors service</label>
                  <div className="p-3 mb-2 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-900">{getPreparationForMachine(selectedMachine)?.notes || 'Aucune raison spécifiée'}</p>
                  </div>
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
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mettre hors service</label>
                  <textarea
                    value={horsServiceText}
                    onChange={(e) => setHorsServiceText(e.target.value)}
                    rows={2}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-2"
                    placeholder="Raison de la mise hors service..."
                  />
                  <Button
                    variant="danger"
                    className="w-full"
                    onClick={() => {
                      if (selectedMachine) handleMarkOutOfService(selectedMachine.id);
                    }}
                    disabled={isSaving}
                    isLoading={isSaving}
                  >
                    Mettre hors service
                  </Button>
                </>
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

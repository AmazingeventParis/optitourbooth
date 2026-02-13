import { useState, useEffect } from 'react';
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
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const machineTypeConfig: Record<MachineType, { label: string; color: string }> = {
  Vegas: { label: 'Vegas', color: 'bg-blue-100 border-blue-300' },
  Smakk: { label: 'Smakk', color: 'bg-purple-100 border-purple-300' },
  Ring: { label: 'Ring', color: 'bg-green-100 border-green-300' },
};

const statutConfig: Record<PreparationStatut, { label: string; color: string; badge: string }> = {
  disponible: { label: 'Disponible', color: 'bg-gray-50 border-gray-200', badge: 'default' },
  en_preparation: { label: 'En préparation', color: 'bg-orange-50 border-orange-300', badge: 'warning' },
  prete: { label: 'Prête', color: 'bg-green-50 border-green-400', badge: 'success' },
  en_cours: { label: 'En cours', color: 'bg-blue-50 border-blue-300', badge: 'info' },
  a_decharger: { label: 'À décharger', color: 'bg-red-50 border-red-400', badge: 'danger' },
  archivee: { label: 'Archivée', color: 'bg-gray-100 border-gray-300', badge: 'default' },
};

export default function PreparationsPage() {
  const { success, error: showError } = useToast();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [archivedPreparations, setArchivedPreparations] = useState<Preparation[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    dateEvenement: '',
    client: '',
    preparateur: '',
    notes: '',
  });

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
    setFormData({
      dateEvenement: '',
      client: '',
      preparateur: '',
      notes: '',
    });
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
      setIsModalOpen(false);
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

  const getPreparationForMachine = (machine: Machine): Preparation | undefined => {
    return machine.preparations && machine.preparations.length > 0
      ? machine.preparations[0]
      : undefined;
  };

  const getMachineStatut = (machine: Machine): PreparationStatut => {
    const prep = getPreparationForMachine(machine);
    return prep?.statut || 'disponible';
  };

  const groupedMachines = {
    Vegas: machines.filter((m) => m.type === 'Vegas'),
    Smakk: machines.filter((m) => m.type === 'Smakk'),
    Ring: machines.filter((m) => m.type === 'Ring'),
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (isArchiveMode) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Archive des événements</h1>
          <Button variant="secondary" onClick={() => {
            setIsArchiveMode(false);
            fetchMachines();
          }}>
            Retour
          </Button>
        </div>

        <Card className="p-6">
          {archivedPreparations.length === 0 ? (
            <p className="text-center text-gray-500 py-8">Aucun événement archivé</p>
          ) : (
            <div className="space-y-2">
              {archivedPreparations.map((prep) => (
                <div key={prep.id} className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{prep.client}</p>
                      <p className="text-sm text-gray-500">
                        {prep.machine?.type} {prep.machine?.numero} • {format(parseISO(prep.dateEvenement), 'd MMMM yyyy', { locale: fr })}
                      </p>
                      <p className="text-xs text-gray-400">Préparateur: {prep.preparateur}</p>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Préparations</h1>
        <Button variant="secondary" onClick={() => {
          setIsArchiveMode(true);
          fetchArchive();
        }}>
          <ArchiveBoxIcon className="h-5 w-5 mr-2" />
          Archive
        </Button>
      </div>

      {Object.entries(groupedMachines).map(([type, machinesOfType]) => {
        const config = machineTypeConfig[type as MachineType];
        return (
          <div key={type}>
            <h2 className="text-lg font-semibold mb-3">{config.label} ({machinesOfType.length})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {machinesOfType.map((machine) => {
                const statut = getMachineStatut(machine);
                const preparation = getPreparationForMachine(machine);
                const statutInfo = statutConfig[statut];

                return (
                  <button
                    key={machine.id}
                    onClick={() => statut === 'disponible' ? handleOpenModal(machine) : null}
                    disabled={statut !== 'disponible'}
                    className={clsx(
                      'p-4 border-2 rounded-lg transition-all text-left relative',
                      statutInfo.color,
                      statut === 'disponible' && 'hover:shadow-md cursor-pointer',
                      statut !== 'disponible' && 'cursor-default'
                    )}
                  >
                    <div className="font-bold text-lg mb-1">{machine.numero}</div>
                    <Badge variant={statutInfo.badge as any}>
                      {statutInfo.label}
                    </Badge>

                    {preparation && (
                      <div className="mt-2 pt-2 border-t border-gray-300">
                        <p className="text-xs font-medium truncate" title={preparation.client}>
                          {preparation.client}
                        </p>
                        <p className="text-xs text-gray-600">
                          {format(parseISO(preparation.dateEvenement), 'd MMM', { locale: fr })}
                        </p>

                        <div className="flex gap-1 mt-2">
                          {statut === 'en_preparation' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsReady(preparation.id);
                              }}
                              className="p-1 bg-green-500 text-white rounded hover:bg-green-600"
                              title="Marquer comme prête"
                              disabled={isSaving}
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                            </button>
                          )}
                          {statut === 'a_decharger' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkPhotosUnloaded(preparation.id);
                              }}
                              className="p-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                              title="Marquer photos déchargées"
                              disabled={isSaving}
                            >
                              <PhotoIcon className="h-4 w-4" />
                            </button>
                          )}
                          {statut === 'prete' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateStatut(preparation.id, 'en_cours');
                              }}
                              className="p-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                              title="Démarrer événement"
                              disabled={isSaving}
                            >
                              <WrenchScrewdriverIcon className="h-4 w-4" />
                            </button>
                          )}
                          {statut === 'en_cours' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateStatut(preparation.id, 'a_decharger');
                              }}
                              className="p-1 bg-orange-500 text-white rounded hover:bg-orange-600"
                              title="Retour - À décharger"
                              disabled={isSaving}
                            >
                              <PhotoIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Modal Création Préparation */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`Préparer ${selectedMachine?.type} ${selectedMachine?.numero}`}
      >
        <div className="space-y-4">
          <Input
            label="Date de l'événement"
            type="date"
            value={formData.dateEvenement}
            onChange={(e) => setFormData({ ...formData, dateEvenement: e.target.value })}
            required
          />
          <Input
            label="Nom du client"
            value={formData.client}
            onChange={(e) => setFormData({ ...formData, client: e.target.value })}
            placeholder="Nom de l'événement ou du client"
            required
          />
          <Input
            label="Préparateur"
            value={formData.preparateur}
            onChange={(e) => setFormData({ ...formData, preparateur: e.target.value })}
            placeholder="Nom du préparateur"
            required
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Notes optionnelles..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => setIsModalOpen(false)}>
              Annuler
            </Button>
            <Button className="flex-1" onClick={handleCreatePreparation} isLoading={isSaving}>
              Créer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

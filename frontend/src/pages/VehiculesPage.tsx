import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Input, Badge, Modal } from '@/components/ui';
import DataTable, { Column } from '@/components/ui/DataTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/hooks/useToast';
import { useSettings, useTerminologie } from '@/hooks/queries/useSettings';
import { TYPE_VEHICULE_LABELS } from '@/constants/settingsLabels';
import { Vehicule, PaginationMeta } from '@/types';
import { PlusIcon, MagnifyingGlassIcon, PencilIcon, TrashIcon, TruckIcon } from '@heroicons/react/24/outline';
import api from '@/services/api';

interface VehiculeFormData {
  nom: string;
  marque: string;
  modele: string;
  immatriculation: string;
  consommationL100km: string;
  capaciteKg: string;
  capaciteM3: string;
  notes: string;
  actif: boolean;
}

const initialFormData: VehiculeFormData = {
  nom: '',
  marque: '',
  modele: '',
  immatriculation: '',
  consommationL100km: '',
  capaciteKg: '',
  capaciteM3: '',
  notes: '',
  actif: true,
};

export default function VehiculesPage() {
  const { success, error: showError } = useToast();
  const termi = useTerminologie();
  const { data: settings } = useSettings();
  const configuredTypes = settings?.flotteMateriel?.typesVehicules ?? [];

  const [vehicules, setVehicules] = useState<Vehicule[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedVehicule, setSelectedVehicule] = useState<Vehicule | null>(null);
  const [formData, setFormData] = useState<VehiculeFormData>(initialFormData);
  const [formErrors, setFormErrors] = useState<Partial<VehiculeFormData>>({});
  const [isSaving, setIsSaving] = useState(false);

  const fetchVehicules = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 20 };
      if (search) params.search = search;

      const response = await api.get('/vehicules', { params });
      setVehicules(response.data.data);
      setMeta(response.data.meta);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [search, showError]);

  useEffect(() => {
    fetchVehicules();
  }, [fetchVehicules]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchVehicules(1);
  };

  const openCreateModal = () => {
    setSelectedVehicule(null);
    setFormData(initialFormData);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (vehicule: Vehicule) => {
    setSelectedVehicule(vehicule);
    setFormData({
      nom: vehicule.nom,
      marque: vehicule.marque || '',
      modele: vehicule.modele || '',
      immatriculation: vehicule.immatriculation,
      consommationL100km: vehicule.consommationL100km?.toString() || '',
      capaciteKg: vehicule.capaciteKg?.toString() || '',
      capaciteM3: vehicule.capaciteM3?.toString() || '',
      notes: vehicule.notes || '',
      actif: vehicule.actif,
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openDeleteDialog = (vehicule: Vehicule) => {
    setSelectedVehicule(vehicule);
    setIsDeleteDialogOpen(true);
  };

  const validateForm = () => {
    const errors: Partial<VehiculeFormData> = {};

    if (!formData.nom) errors.nom = 'Nom requis';
    if (!formData.immatriculation) errors.immatriculation = 'Immatriculation requise';

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const data = {
        nom: formData.nom,
        marque: formData.marque || null,
        modele: formData.modele || null,
        immatriculation: formData.immatriculation,
        consommationL100km: formData.consommationL100km ? parseFloat(formData.consommationL100km) : null,
        capaciteKg: formData.capaciteKg ? parseFloat(formData.capaciteKg) : null,
        capaciteM3: formData.capaciteM3 ? parseFloat(formData.capaciteM3) : null,
        notes: formData.notes || null,
        actif: formData.actif,
      };

      if (selectedVehicule) {
        await api.put(`/vehicules/${selectedVehicule.id}`, data);
        success('Véhicule modifié');
      } else {
        await api.post('/vehicules', data);
        success('Véhicule créé');
      }
      setIsModalOpen(false);
      fetchVehicules();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedVehicule) return;

    setIsSaving(true);
    try {
      await api.delete(`/vehicules/${selectedVehicule.id}`);
      success('Véhicule supprimé');
      setIsDeleteDialogOpen(false);
      fetchVehicules();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const columns: Column<Vehicule>[] = [
    {
      key: 'nom',
      header: 'Véhicule',
      render: (vehicule) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <TruckIcon className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="font-medium">{vehicule.nom}</p>
            {(vehicule.marque || vehicule.modele) && (
              <p className="text-sm text-gray-500">
                {[vehicule.marque, vehicule.modele].filter(Boolean).join(' ')}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'immatriculation',
      header: 'Immatriculation',
      render: (vehicule) => (
        <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
          {vehicule.immatriculation}
        </span>
      ),
    },
    {
      key: 'consommation',
      header: 'Consommation',
      render: (vehicule) => vehicule.consommationL100km
        ? `${vehicule.consommationL100km} L/100km`
        : '-',
    },
    {
      key: 'capacite',
      header: 'Capacité',
      render: (vehicule) => {
        const parts = [];
        if (vehicule.capaciteKg) parts.push(`${vehicule.capaciteKg} kg`);
        if (vehicule.capaciteM3) parts.push(`${vehicule.capaciteM3} m³`);
        return parts.length > 0 ? parts.join(' / ') : '-';
      },
    },
    {
      key: 'tournees',
      header: 'Tournées',
      render: (vehicule) => (
        <span className="text-sm text-gray-600">
          {vehicule._count?.tournees || 0} tournées
        </span>
      ),
    },
    {
      key: 'actif',
      header: 'Statut',
      render: (vehicule) => (
        <Badge variant={vehicule.actif ? 'success' : 'danger'}>
          {vehicule.actif ? 'Actif' : 'Inactif'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (vehicule) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(vehicule);
            }}
          >
            <PencilIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openDeleteDialog(vehicule);
            }}
          >
            <TrashIcon className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{termi.vehicule}s</h1>
          <p className="text-gray-500">Gérez la flotte de {termi.vehicule.toLowerCase()}s</p>
          {configuredTypes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {configuredTypes.map((t) => (
                <span key={t} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                  {TYPE_VEHICULE_LABELS[t] || t}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button onClick={openCreateModal}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Nouveau {termi.vehicule.toLowerCase()}
        </Button>
      </div>

      <Card>
        <form onSubmit={handleSearch} className="flex gap-4 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Rechercher par nom, marque, immatriculation..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            <MagnifyingGlassIcon className="h-5 w-5" />
          </Button>
        </form>

        <DataTable
          columns={columns}
          data={vehicules}
          keyExtractor={(vehicule) => vehicule.id}
          isLoading={isLoading}
          emptyMessage="Aucun véhicule trouvé"
          pagination={{
            page: meta.page,
            limit: meta.limit,
            total: meta.total,
            onPageChange: fetchVehicules,
          }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedVehicule ? 'Modifier le véhicule' : 'Nouveau véhicule'}
      >
        <div className="space-y-4">
          <Input
            label="Nom du véhicule"
            value={formData.nom}
            onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
            error={formErrors.nom}
            placeholder="Ex: Utilitaire Blanc, Fourgon 1..."
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Marque"
              value={formData.marque}
              onChange={(e) => setFormData({ ...formData, marque: e.target.value })}
              placeholder="Ex: Renault, Mercedes..."
            />
            <Input
              label="Modèle"
              value={formData.modele}
              onChange={(e) => setFormData({ ...formData, modele: e.target.value })}
              placeholder="Ex: Master, Sprinter..."
            />
          </div>

          <Input
            label="Immatriculation"
            value={formData.immatriculation}
            onChange={(e) => setFormData({ ...formData, immatriculation: e.target.value.toUpperCase() })}
            error={formErrors.immatriculation}
            placeholder="AA-123-BB"
            required
          />

          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Caractéristiques</h3>
            <div className="grid grid-cols-3 gap-4">
              <Input
                label="Consommation (L/100km)"
                type="number"
                step="0.1"
                min="0"
                max="50"
                value={formData.consommationL100km}
                onChange={(e) => setFormData({ ...formData, consommationL100km: e.target.value })}
                placeholder="Ex: 9.5"
              />
              <Input
                label="Capacité (kg)"
                type="number"
                step="1"
                min="0"
                value={formData.capaciteKg}
                onChange={(e) => setFormData({ ...formData, capaciteKg: e.target.value })}
                placeholder="Ex: 1500"
              />
              <Input
                label="Volume (m³)"
                type="number"
                step="0.1"
                min="0"
                value={formData.capaciteM3}
                onChange={(e) => setFormData({ ...formData, capaciteM3: e.target.value })}
                placeholder="Ex: 12.5"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Informations supplémentaires..."
            />
          </div>

          {selectedVehicule && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="actif"
                checked={formData.actif}
                onChange={(e) => setFormData({ ...formData, actif: e.target.checked })}
                className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <label htmlFor="actif" className="text-sm text-gray-700">
                Véhicule actif
              </label>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} isLoading={isSaving}>
              {selectedVehicule ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Supprimer le véhicule"
        message={
          selectedVehicule?._count?.tournees && selectedVehicule._count.tournees > 0
            ? `Ce véhicule a ${selectedVehicule._count.tournees} tournée(s) associée(s). Il sera désactivé au lieu d'être supprimé.`
            : `Êtes-vous sûr de vouloir supprimer définitivement le véhicule "${selectedVehicule?.nom}" ? Cette action est irréversible.`
        }
        confirmText={selectedVehicule?._count?.tournees && selectedVehicule._count.tournees > 0 ? 'Désactiver' : 'Supprimer'}
        variant="danger"
        isLoading={isSaving}
      />
    </div>
  );
}

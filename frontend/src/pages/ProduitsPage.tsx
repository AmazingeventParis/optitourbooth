import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Input, Badge, Modal } from '@/components/ui';
import DataTable, { Column } from '@/components/ui/DataTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { produitsService } from '@/services/produits.service';
import { useToast } from '@/hooks/useToast';
import { PaginationMeta } from '@/types';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  ClockIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline';
import { CheckIcon } from '@heroicons/react/24/solid';

// Couleurs Google Agenda
const GOOGLE_CALENDAR_COLORS = [
  { name: 'Lavande', hex: '#7986CB' },
  { name: 'Sauge', hex: '#33B679' },
  { name: 'Raisin', hex: '#8E24AA' },
  { name: 'Flamant', hex: '#E67C73' },
  { name: 'Banane', hex: '#F6BF26' },
  { name: 'Mandarine', hex: '#F4511E' },
  { name: 'Paon', hex: '#039BE5' },
  { name: 'Graphite', hex: '#616161' },
  { name: 'Myrtille', hex: '#3F51B5' },
  { name: 'Basilic', hex: '#0B8043' },
  { name: 'Tomate', hex: '#D50000' },
];

interface ProduitOption {
  id: string;
  nom: string;
  description?: string;
  dureeSupp: number;
  actif: boolean;
}

interface ProduitWithOptions {
  id: string;
  nom: string;
  couleur?: string;
  dureeInstallation: number;
  dureeDesinstallation: number;
  poids?: number;
  largeur?: number;
  hauteur?: number;
  profondeur?: number;
  actif: boolean;
  options: ProduitOption[];
}

interface ProduitFormData {
  nom: string;
  couleur: string;
  dureeInstallation: number;
  dureeDesinstallation: number;
  poids: string;
  largeur: string;
  hauteur: string;
  profondeur: string;
}

const initialFormData: ProduitFormData = {
  nom: '',
  couleur: '',
  dureeInstallation: 30,
  dureeDesinstallation: 20,
  poids: '',
  largeur: '',
  hauteur: '',
  profondeur: '',
};

export default function ProduitsPage() {
  const { success, error: showError } = useToast();

  const [produits, setProduits] = useState<ProduitWithOptions[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProduit, setSelectedProduit] = useState<ProduitWithOptions | null>(null);
  const [formData, setFormData] = useState<ProduitFormData>(initialFormData);
  const [formErrors, setFormErrors] = useState<Partial<ProduitFormData>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Options modal
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [selectedProduitForOptions, setSelectedProduitForOptions] = useState<ProduitWithOptions | null>(null);
  const [optionFormData, setOptionFormData] = useState({ nom: '', description: '', dureeSupp: 0 });

  const fetchProduits = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const filters: Record<string, unknown> = { page, limit: 20 };
      if (search) filters.search = search;

      const result = await produitsService.list(filters);
      setProduits(result.data);
      setMeta(result.meta);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [search, showError]);

  useEffect(() => {
    fetchProduits();
  }, [fetchProduits]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProduits(1);
  };

  const openCreateModal = () => {
    setSelectedProduit(null);
    setFormData(initialFormData);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (produit: ProduitWithOptions) => {
    setSelectedProduit(produit);
    setFormData({
      nom: produit.nom,
      couleur: produit.couleur || '',
      dureeInstallation: produit.dureeInstallation,
      dureeDesinstallation: produit.dureeDesinstallation,
      poids: produit.poids?.toString() || '',
      largeur: produit.largeur?.toString() || '',
      hauteur: produit.hauteur?.toString() || '',
      profondeur: produit.profondeur?.toString() || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openDeleteDialog = (produit: ProduitWithOptions) => {
    setSelectedProduit(produit);
    setIsDeleteDialogOpen(true);
  };

  const openOptionsModal = (produit: ProduitWithOptions) => {
    setSelectedProduitForOptions(produit);
    setOptionFormData({ nom: '', description: '', dureeSupp: 0 });
    setIsOptionsModalOpen(true);
  };

  const validateForm = () => {
    const errors: Partial<ProduitFormData> = {};

    if (!formData.nom) errors.nom = 'Nom requis';

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const data = {
        nom: formData.nom,
        couleur: formData.couleur || undefined,
        dureeInstallation: formData.dureeInstallation,
        dureeDesinstallation: formData.dureeDesinstallation,
        poids: formData.poids ? parseFloat(formData.poids) : undefined,
        largeur: formData.largeur ? parseFloat(formData.largeur) : undefined,
        hauteur: formData.hauteur ? parseFloat(formData.hauteur) : undefined,
        profondeur: formData.profondeur ? parseFloat(formData.profondeur) : undefined,
      };

      if (selectedProduit) {
        await produitsService.update(selectedProduit.id, data);
        success('Produit modifié');
      } else {
        await produitsService.create(data);
        success('Produit créé');
      }
      setIsModalOpen(false);
      fetchProduits();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProduit) return;

    setIsSaving(true);
    try {
      await produitsService.delete(selectedProduit.id);
      success('Produit supprimé');
      setIsDeleteDialogOpen(false);
      fetchProduits();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddOption = async () => {
    if (!selectedProduitForOptions || !optionFormData.nom) return;

    try {
      await produitsService.createOption(selectedProduitForOptions.id, optionFormData);
      success('Option ajoutée');
      setOptionFormData({ nom: '', description: '', dureeSupp: 0 });
      // Refresh produit
      const updated = await produitsService.getById(selectedProduitForOptions.id);
      setSelectedProduitForOptions(updated);
      fetchProduits();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    }
  };

  const handleDeleteOption = async (optionId: string) => {
    if (!selectedProduitForOptions) return;

    try {
      await produitsService.deleteOption(selectedProduitForOptions.id, optionId);
      success('Option supprimée');
      const updated = await produitsService.getById(selectedProduitForOptions.id);
      setSelectedProduitForOptions(updated);
      fetchProduits();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    }
  };

  const columns: Column<ProduitWithOptions>[] = [
    {
      key: 'nom',
      header: 'Produit',
      render: (produit) => (
        <div className="flex items-center gap-3">
          {produit.couleur && (
            <div
              className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200"
              style={{ backgroundColor: produit.couleur }}
            />
          )}
          <p className="font-medium">{produit.nom}</p>
        </div>
      ),
    },
    {
      key: 'durees',
      header: 'Durées',
      render: (produit) => (
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center">
            <ClockIcon className="h-4 w-4 mr-1 text-green-500" />
            {produit.dureeInstallation}min
          </span>
          <span className="flex items-center">
            <ClockIcon className="h-4 w-4 mr-1 text-orange-500" />
            {produit.dureeDesinstallation}min
          </span>
        </div>
      ),
    },
    {
      key: 'options',
      header: 'Options',
      render: (produit) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            openOptionsModal(produit);
          }}
          className="text-primary-600 hover:text-primary-700 text-sm"
        >
          {produit.options.filter((o) => o.actif).length} options
        </button>
      ),
    },
    {
      key: 'actif',
      header: 'Statut',
      render: (produit) => (
        <Badge variant={produit.actif ? 'success' : 'danger'}>
          {produit.actif ? 'Actif' : 'Inactif'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (produit) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(produit);
            }}
          >
            <PencilIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openDeleteDialog(produit);
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
          <h1 className="text-2xl font-bold text-gray-900">Produits</h1>
          <p className="text-gray-500">Gérez vos types de bornes photobooth</p>
        </div>
        <Button onClick={openCreateModal}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Nouveau produit
        </Button>
      </div>

      <Card>
        <form onSubmit={handleSearch} className="flex gap-4 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Rechercher par nom..."
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
          data={produits}
          keyExtractor={(produit) => produit.id}
          isLoading={isLoading}
          emptyMessage="Aucun produit trouvé"
          pagination={{
            page: meta.page,
            limit: meta.limit,
            total: meta.total,
            onPageChange: fetchProduits,
          }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedProduit ? 'Modifier le produit' : 'Nouveau produit'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nom"
            value={formData.nom}
            onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
            error={formErrors.nom}
            required
          />

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-900 mb-3 flex items-center">
              <SwatchIcon className="h-5 w-5 mr-2" />
              Couleur d'identification
            </h4>
            <div className="flex flex-wrap gap-2">
              {GOOGLE_CALENDAR_COLORS.map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  title={color.name}
                  onClick={() => setFormData({ ...formData, couleur: color.hex })}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${
                    formData.couleur === color.hex ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                  }`}
                  style={{ backgroundColor: color.hex }}
                >
                  {formData.couleur === color.hex && (
                    <CheckIcon className="h-4 w-4 text-white" />
                  )}
                </button>
              ))}
              {formData.couleur && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, couleur: '' })}
                  className="text-xs text-gray-500 hover:text-gray-700 ml-2 self-center"
                >
                  Effacer
                </button>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-900 mb-3 flex items-center">
              <ClockIcon className="h-5 w-5 mr-2" />
              Durées (en minutes)
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Installation"
                type="number"
                min="0"
                value={formData.dureeInstallation}
                onChange={(e) => setFormData({ ...formData, dureeInstallation: parseInt(e.target.value) || 0 })}
              />
              <Input
                label="Désinstallation"
                type="number"
                min="0"
                value={formData.dureeDesinstallation}
                onChange={(e) => setFormData({ ...formData, dureeDesinstallation: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-900 mb-3">Dimensions (optionnel)</h4>
            <div className="grid grid-cols-4 gap-4">
              <Input
                label="Poids (kg)"
                type="number"
                step="0.1"
                value={formData.poids}
                onChange={(e) => setFormData({ ...formData, poids: e.target.value })}
              />
              <Input
                label="Largeur (cm)"
                type="number"
                value={formData.largeur}
                onChange={(e) => setFormData({ ...formData, largeur: e.target.value })}
              />
              <Input
                label="Hauteur (cm)"
                type="number"
                value={formData.hauteur}
                onChange={(e) => setFormData({ ...formData, hauteur: e.target.value })}
              />
              <Input
                label="Profondeur (cm)"
                type="number"
                value={formData.profondeur}
                onChange={(e) => setFormData({ ...formData, profondeur: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} isLoading={isSaving}>
              {selectedProduit ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Options Modal */}
      <Modal
        isOpen={isOptionsModalOpen}
        onClose={() => setIsOptionsModalOpen(false)}
        title={`Options - ${selectedProduitForOptions?.nom}`}
        size="md"
      >
        <div className="space-y-4">
          {/* Add new option */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium mb-3">Ajouter une option</h4>
            <div className="space-y-3">
              <Input
                label="Nom"
                value={optionFormData.nom}
                onChange={(e) => setOptionFormData({ ...optionFormData, nom: e.target.value })}
                placeholder="Ex: Fond vert"
              />
              <Input
                label="Durée supplémentaire (min)"
                type="number"
                min="0"
                value={optionFormData.dureeSupp}
                onChange={(e) => setOptionFormData({ ...optionFormData, dureeSupp: parseInt(e.target.value) || 0 })}
              />
              <Button size="sm" onClick={handleAddOption} disabled={!optionFormData.nom}>
                <PlusIcon className="h-4 w-4 mr-1" />
                Ajouter
              </Button>
            </div>
          </div>

          {/* Options list */}
          <div>
            <h4 className="font-medium mb-3">Options existantes</h4>
            {selectedProduitForOptions?.options.length === 0 ? (
              <p className="text-gray-500 text-sm">Aucune option</p>
            ) : (
              <div className="space-y-2">
                {selectedProduitForOptions?.options.map((option) => (
                  <div
                    key={option.id}
                    className="flex items-center justify-between p-3 bg-white border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{option.nom}</p>
                      <p className="text-sm text-gray-500">+{option.dureeSupp} min</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={option.actif ? 'success' : 'danger'} size="sm">
                        {option.actif ? 'Actif' : 'Inactif'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteOption(option.id)}
                      >
                        <TrashIcon className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Supprimer le produit"
        message={`Êtes-vous sûr de vouloir supprimer définitivement "${selectedProduit?.nom}" ? Cette action est irréversible.`}
        confirmText="Supprimer"
        variant="danger"
        isLoading={isSaving}
      />
    </div>
  );
}

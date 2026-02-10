import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, Select, Badge, Modal, TimeSelect } from '@/components/ui';
import DataTable, { Column } from '@/components/ui/DataTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { tourneesService } from '@/services/tournees.service';
import { usersService } from '@/services/users.service';
import { useToast } from '@/hooks/useToast';
import { Tournee, User, PaginationMeta, TourneeStatut } from '@/types';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatTime } from '@/utils/format';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  EyeIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  MapPinIcon,
  ClockIcon,
  TruckIcon,
} from '@heroicons/react/24/outline';

// Hook de debounce personnalisé
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

interface TourneeFormData {
  date: string;
  chauffeurId: string;
  heureDepart: string;
  depotAdresse: string;
  notes: string;
}

const initialFormData: TourneeFormData = {
  date: format(new Date(), 'yyyy-MM-dd'),
  chauffeurId: '',
  heureDepart: '08:00',
  depotAdresse: '',
  notes: '',
};

const statutOptions: { value: TourneeStatut | ''; label: string }[] = [
  { value: '', label: 'Tous les statuts' },
  { value: 'planifiee', label: 'Planifiée' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'terminee', label: 'Terminée' },
  { value: 'annulee', label: 'Annulée' },
];

const getStatutBadge = (statut: TourneeStatut) => {
  const config = {
    brouillon: { variant: 'default' as const, label: 'Brouillon' },
    planifiee: { variant: 'info' as const, label: 'Planifiée' },
    en_cours: { variant: 'warning' as const, label: 'En cours' },
    terminee: { variant: 'success' as const, label: 'Terminée' },
    annulee: { variant: 'danger' as const, label: 'Annulée' },
  };
  const { variant, label } = config[statut];
  return <Badge variant={variant}>{label}</Badge>;
};

export default function TourneesPage() {
  const navigate = useNavigate();
  const { success, error: showError } = useToast();

  const [tournees, setTournees] = useState<Tournee[]>([]);
  const [chauffeurs, setChauffeurs] = useState<User[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [dateFilter, setDateFilter] = useState('');
  const [chauffeurFilter, setChauffeurFilter] = useState('');
  const [statutFilter, setStatutFilter] = useState('');

  // Debounce des filtres pour éviter les appels API excessifs
  const debouncedDateFilter = useDebounce(dateFilter, 300);
  const debouncedChauffeurFilter = useDebounce(chauffeurFilter, 300);
  const debouncedStatutFilter = useDebounce(statutFilter, 300);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTournee, setSelectedTournee] = useState<Tournee | null>(null);
  const [formData, setFormData] = useState<TourneeFormData>(initialFormData);
  const [duplicateDate, setDuplicateDate] = useState('');
  const [formErrors, setFormErrors] = useState<Partial<TourneeFormData>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Mémoisation des options de chauffeurs pour éviter les recréations
  const chauffeurOptions = useMemo(() => [
    { value: '', label: 'Tous les chauffeurs' },
    ...chauffeurs.map((c) => ({
      value: c.id,
      label: `${c.prenom} ${c.nom}`,
    })),
  ], [chauffeurs]);

  const chauffeurSelectOptions = useMemo(() => [
    { value: '', label: 'Sélectionner un chauffeur' },
    ...chauffeurs.map((c) => ({
      value: c.id,
      label: `${c.prenom} ${c.nom}`,
    })),
  ], [chauffeurs]);

  const fetchTournees = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const filters: Record<string, unknown> = { page, limit: 20 };
      if (debouncedDateFilter) filters.date = debouncedDateFilter;
      if (debouncedChauffeurFilter) filters.chauffeurId = debouncedChauffeurFilter;
      if (debouncedStatutFilter) filters.statut = debouncedStatutFilter;

      const result = await tourneesService.list(filters);
      setTournees(result.data);
      setMeta(result.meta);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedDateFilter, debouncedChauffeurFilter, debouncedStatutFilter, showError]);

  const fetchChauffeurs = async () => {
    try {
      const result = await usersService.listChauffeurs();
      setChauffeurs(result);
    } catch (err) {
      console.error('Erreur chargement chauffeurs:', err);
    }
  };

  useEffect(() => {
    fetchTournees();
    fetchChauffeurs();
  }, [fetchTournees]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTournees(1);
  };

  const openCreateModal = () => {
    setSelectedTournee(null);
    setFormData(initialFormData);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openDuplicateModal = (tournee: Tournee) => {
    setSelectedTournee(tournee);
    setDuplicateDate(format(new Date(), 'yyyy-MM-dd'));
    setIsDuplicateModalOpen(true);
  };

  const openDeleteDialog = (tournee: Tournee) => {
    setSelectedTournee(tournee);
    setIsDeleteDialogOpen(true);
  };

  const validateForm = () => {
    const errors: Partial<TourneeFormData> = {};

    if (!formData.date) errors.date = 'Date requise';
    if (!formData.chauffeurId) errors.chauffeurId = 'Chauffeur requis';
    if (!formData.heureDepart) errors.heureDepart = 'Heure de départ requise';

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      await tourneesService.create({
        date: formData.date,
        chauffeurId: formData.chauffeurId,
        heureDepart: formData.heureDepart,
        depotAdresse: formData.depotAdresse || undefined,
        notes: formData.notes || undefined,
      });
      success('Tournée créée');
      setIsModalOpen(false);
      fetchTournees();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!selectedTournee || !duplicateDate) return;

    setIsSaving(true);
    try {
      const newTournee = await tourneesService.duplicate(selectedTournee.id, duplicateDate);
      success('Tournée dupliquée');
      setIsDuplicateModalOpen(false);
      navigate(`/tournees/${newTournee.id}`);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTournee) return;

    setIsSaving(true);
    try {
      await tourneesService.delete(selectedTournee.id);
      success('Tournée supprimée');
      setIsDeleteDialogOpen(false);
      fetchTournees();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Mémoisation des colonnes pour éviter les re-renders de DataTable
  const columns: Column<Tournee>[] = useMemo(() => [
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      sortValue: (tournee) => tournee.date,
      render: (tournee) => (
        <div>
          <p className="font-medium">
            {format(parseISO(tournee.date), 'EEEE d MMMM yyyy', { locale: fr })}
          </p>
          {tournee.heureDepart && (
            <p className="text-sm text-gray-500 flex items-center mt-1">
              <ClockIcon className="h-4 w-4 mr-1" />
              Départ: {formatTime(tournee.heureDepart)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'chauffeur',
      header: 'Chauffeur',
      sortable: true,
      sortValue: (tournee) => tournee.chauffeur ? `${tournee.chauffeur.prenom} ${tournee.chauffeur.nom}` : '',
      render: (tournee) => (
        <div className="flex items-center gap-2">
          {tournee.chauffeur?.couleur ? (
            <div
              className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200"
              style={{ backgroundColor: tournee.chauffeur.couleur }}
            />
          ) : (
            <TruckIcon className="h-5 w-5 text-gray-400" />
          )}
          <span>
            {tournee.chauffeur
              ? `${tournee.chauffeur.prenom} ${tournee.chauffeur.nom}`
              : '-'}
          </span>
        </div>
      ),
    },
    {
      key: 'points',
      header: 'Points',
      sortable: true,
      sortValue: (tournee) => tournee.nombrePoints,
      render: (tournee) => (
        <div className="flex items-center">
          <MapPinIcon className="h-5 w-5 text-gray-400 mr-2" />
          <span>{tournee.nombrePoints} point{tournee.nombrePoints > 1 ? 's' : ''}</span>
        </div>
      ),
    },
    {
      key: 'stats',
      header: 'Distance / Durée',
      sortable: true,
      sortValue: (tournee) => tournee.distanceTotaleKm ?? null,
      render: (tournee) => (
        <div className="text-sm">
          {tournee.distanceTotaleKm ? (
            <>
              <p>{tournee.distanceTotaleKm.toFixed(1)} km</p>
              {tournee.dureeTotaleMin && (
                <p className="text-gray-500">
                  {Math.floor(tournee.dureeTotaleMin / 60)}h{String(tournee.dureeTotaleMin % 60).padStart(2, '0')}
                </p>
              )}
            </>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </div>
      ),
    },
    {
      key: 'statut',
      header: 'Statut',
      sortable: true,
      sortValue: (tournee) => tournee.statut,
      render: (tournee) => getStatutBadge(tournee.statut),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (tournee) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/tournees/${tournee.id}`);
            }}
            title="Voir détails"
          >
            <EyeIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openDuplicateModal(tournee);
            }}
            title="Dupliquer"
          >
            <DocumentDuplicateIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openDeleteDialog(tournee);
            }}
            title="Supprimer"
          >
            <TrashIcon className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      ),
    },
  ], [navigate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tournées</h1>
          <p className="text-gray-500">Planifiez et gérez vos tournées de livraison</p>
        </div>
        <Button onClick={openCreateModal}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Nouvelle tournée
        </Button>
      </div>

      <Card>
        <form onSubmit={handleSearch} className="flex gap-4 mb-6 flex-wrap">
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-40"
          />
          <Select
            value={chauffeurFilter}
            onChange={(e) => setChauffeurFilter(e.target.value)}
            options={chauffeurOptions}
          />
          <Select
            value={statutFilter}
            onChange={(e) => setStatutFilter(e.target.value)}
            options={statutOptions}
          />
          <Button type="submit" variant="secondary">
            <MagnifyingGlassIcon className="h-5 w-5" />
          </Button>
        </form>

        <DataTable
          columns={columns}
          data={tournees}
          keyExtractor={(tournee) => tournee.id}
          isLoading={isLoading}
          emptyMessage="Aucune tournée trouvée"
          onRowClick={(tournee) => navigate(`/tournees/${tournee.id}`)}
          pagination={{
            page: meta.page,
            limit: meta.limit,
            total: meta.total,
            onPageChange: fetchTournees,
          }}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nouvelle tournée"
      >
        <div className="space-y-4">
          <Input
            label="Date"
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            error={formErrors.date}
            required
          />
          <Select
            label="Chauffeur"
            value={formData.chauffeurId}
            onChange={(e) => setFormData({ ...formData, chauffeurId: e.target.value })}
            options={chauffeurSelectOptions}
            error={formErrors.chauffeurId}
            required
          />
          <TimeSelect
            label="Heure de départ"
            value={formData.heureDepart}
            onChange={(value) => setFormData({ ...formData, heureDepart: value })}
            error={formErrors.heureDepart}
            required
          />
          <Input
            label="Adresse du dépôt (optionnel)"
            value={formData.depotAdresse}
            onChange={(e) => setFormData({ ...formData, depotAdresse: e.target.value })}
            placeholder="Adresse de départ du véhicule"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optionnel)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
              placeholder="Notes pour cette tournée..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} isLoading={isSaving}>
              Créer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Duplicate Modal */}
      <Modal
        isOpen={isDuplicateModalOpen}
        onClose={() => setIsDuplicateModalOpen(false)}
        title="Dupliquer la tournée"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Créer une copie de cette tournée avec tous ses points pour une nouvelle date.
          </p>
          <Input
            label="Nouvelle date"
            type="date"
            value={duplicateDate}
            onChange={(e) => setDuplicateDate(e.target.value)}
            required
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsDuplicateModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleDuplicate} isLoading={isSaving}>
              Dupliquer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Supprimer la tournée"
        message="Êtes-vous sûr de vouloir supprimer cette tournée ? Cette action est irréversible."
        confirmText="Supprimer"
        isLoading={isSaving}
      />
    </div>
  );
}

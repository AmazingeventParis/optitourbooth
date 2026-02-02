import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Button, Card, Badge, Modal, Select, Input, SearchableSelect, TimeSelect } from '@/components/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { RouteMap } from '@/components/map';
import SortablePointCard from '@/components/tournee/SortablePointCard';
import ImportExcelModal from '@/components/tournee/ImportExcelModal';
import { tourneesService } from '@/services/tournees.service';
import { clientsService } from '@/services/clients.service';
import { produitsService } from '@/services/produits.service';
import { useToast } from '@/hooks/useToast';
import { Tournee, Point, Client, Produit, TourneeStatut, PointType } from '@/types';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatTime } from '@/utils/format';
import {
  ArrowLeftIcon,
  PlusIcon,
  BoltIcon,
  PlayIcon,
  CheckIcon,
  XMarkIcon,
  MapPinIcon,
  ClockIcon,
  TruckIcon,
  ArrowPathIcon,
  DocumentArrowUpIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

const getStatutConfig = (statut: TourneeStatut) => {
  const configs = {
    brouillon: { variant: 'secondary' as const, label: 'Brouillon' },
    planifiee: { variant: 'info' as const, label: 'Planifiée' },
    en_cours: { variant: 'warning' as const, label: 'En cours' },
    terminee: { variant: 'success' as const, label: 'Terminée' },
    annulee: { variant: 'danger' as const, label: 'Annulée' },
  };
  return configs[statut];
};

interface PointFormData {
  clientId: string;
  type: PointType;
  creneauDebut: string;
  creneauFin: string;
  dureePrevue: number;
  notesInternes: string;
  notesClient: string;
  produits: Array<{ produitId: string; quantite: number }>;
  // Nouveau client manuel
  isNewClient: boolean;
  newClientNom: string;
  newClientAdresse: string;
  newClientCodePostal: string;
  newClientVille: string;
  newClientTelephone: string;
  // Édition client existant
  editClientNom: string;
  editClientEmail: string;
  editClientTelephone: string;
  editClientAdresse: string;
  editClientComplementAdresse: string;
  editClientCodePostal: string;
  editClientVille: string;
  editClientInstructionsAcces: string;
  editClientContactNom: string;
  editClientContactTelephone: string;
}

const initialPointFormData: PointFormData = {
  clientId: '',
  type: 'livraison',
  creneauDebut: '',
  creneauFin: '',
  dureePrevue: 30,
  notesInternes: '',
  notesClient: '',
  produits: [],
  isNewClient: false,
  newClientNom: '',
  newClientAdresse: '',
  newClientCodePostal: '',
  newClientVille: '',
  newClientTelephone: '',
  editClientNom: '',
  editClientEmail: '',
  editClientTelephone: '',
  editClientAdresse: '',
  editClientComplementAdresse: '',
  editClientCodePostal: '',
  editClientVille: '',
  editClientInstructionsAcces: '',
  editClientContactNom: '',
  editClientContactTelephone: '',
};

export default function TourneeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success, error: showError } = useToast();

  const [tournee, setTournee] = useState<Tournee | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Selected point for map highlight
  const [selectedPointId, setSelectedPointId] = useState<string | undefined>();

  // Modal states
  const [isPointModalOpen, setIsPointModalOpen] = useState(false);
  const [isDeletePointDialogOpen, setIsDeletePointDialogOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDeleteTourneeDialogOpen, setIsDeleteTourneeDialogOpen] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [statusAction, setStatusAction] = useState<'start' | 'finish' | 'cancel' | null>(null);
  const [pointFormData, setPointFormData] = useState<PointFormData>(initialPointFormData);
  const [pointFormErrors, setPointFormErrors] = useState<Partial<PointFormData>>({});

  // DnD sensors avec distance d'activation réduite
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Seulement 5px de mouvement requis
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fetchTournee = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const result = await tourneesService.getById(id);
      setTournee(result);
      setPoints(result.points || []);
    } catch (err) {
      showError('Erreur', (err as Error).message);
      navigate('/planning');
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate, showError]);

  const fetchClients = async () => {
    try {
      const result = await clientsService.list({ limit: 1000 });
      setClients(result.data.filter((c) => c.actif && c.latitude && c.longitude));
    } catch (err) {
      console.error('Erreur chargement clients:', err);
    }
  };

  const fetchProduits = async () => {
    try {
      const result = await produitsService.list({ limit: 1000 });
      setProduits(result.data.filter((p) => p.actif));
    } catch (err) {
      console.error('Erreur chargement produits:', err);
    }
  };

  useEffect(() => {
    fetchTournee();
    fetchClients();
    fetchProduits();
  }, [fetchTournee]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // Utiliser les points triés par ordre pour le drag & drop
      const sortedPoints = [...points].sort((a, b) => a.ordre - b.ordre);
      const oldIndex = sortedPoints.findIndex((p) => p.id === active.id);
      const newIndex = sortedPoints.findIndex((p) => p.id === over.id);

      const newPoints = arrayMove(sortedPoints, oldIndex, newIndex);
      // Mettre à jour l'ordre dans le state
      const reorderedPoints = newPoints.map((p, index) => ({ ...p, ordre: index }));
      setPoints(reorderedPoints);

      // Save new order
      try {
        await tourneesService.reorderPoints(
          id!,
          newPoints.map((p) => p.id)
        );
        success('Ordre mis à jour');
        fetchTournee(); // Refresh to get updated stats
      } catch (err) {
        showError('Erreur', (err as Error).message);
        fetchTournee(); // Revert on error
      }
    }
  };

  const handleOptimize = async () => {
    if (!id) return;
    setIsOptimizing(true);
    try {
      const result = await tourneesService.optimize(id);
      setTournee(result.tournee);
      setPoints(result.tournee.points || []);
      success(
        `Tournée optimisée ! ${result.improvements.distanceSaved.toFixed(1)} km économisés`
      );
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsOptimizing(false);
    }
  };

  const openAddPointModal = () => {
    setSelectedPoint(null);
    setPointFormData(initialPointFormData);
    setPointFormErrors({});
    setIsPointModalOpen(true);
  };

  const openEditPointModal = (point: Point) => {
    setSelectedPoint(point);
    const client = point.client;
    setPointFormData({
      clientId: point.clientId,
      type: point.type,
      creneauDebut: point.creneauDebut || '',
      creneauFin: point.creneauFin || '',
      dureePrevue: point.dureePrevue,
      notesInternes: point.notesInternes || '',
      notesClient: point.notesClient || '',
      produits: point.produits?.map((p) => ({
        produitId: p.produitId,
        quantite: p.quantite,
      })) || [],
      isNewClient: false,
      newClientNom: '',
      newClientAdresse: '',
      newClientCodePostal: '',
      newClientVille: '',
      newClientTelephone: '',
      // Pré-remplir les infos du client existant
      editClientNom: client?.nom || '',
      editClientEmail: client?.email || '',
      editClientTelephone: client?.telephone || '',
      editClientAdresse: client?.adresse || '',
      editClientComplementAdresse: client?.complementAdresse || '',
      editClientCodePostal: client?.codePostal || '',
      editClientVille: client?.ville || '',
      editClientInstructionsAcces: client?.instructionsAcces || '',
      editClientContactNom: client?.contactNom || '',
      editClientContactTelephone: client?.contactTelephone || '',
    });
    setPointFormErrors({});
    setIsPointModalOpen(true);
  };

  const openDeletePointDialog = (point: Point) => {
    setSelectedPoint(point);
    setIsDeletePointDialogOpen(true);
  };

  const validatePointForm = () => {
    const errors: Partial<Record<string, string>> = {};
    if (selectedPoint) {
      // Validation pour l'édition
      if (!pointFormData.editClientNom) errors.editClientNom = 'Nom requis';
      if (!pointFormData.editClientAdresse) errors.editClientAdresse = 'Adresse requise';
      if (!pointFormData.editClientCodePostal) errors.editClientCodePostal = 'Code postal requis';
      if (!pointFormData.editClientVille) errors.editClientVille = 'Ville requise';
    } else if (pointFormData.isNewClient) {
      if (!pointFormData.newClientNom) errors.newClientNom = 'Nom requis';
      if (!pointFormData.newClientAdresse) errors.newClientAdresse = 'Adresse requise';
      if (!pointFormData.newClientCodePostal) errors.newClientCodePostal = 'Code postal requis';
      if (!pointFormData.newClientVille) errors.newClientVille = 'Ville requise';
    } else {
      if (!pointFormData.clientId) errors.clientId = 'Client requis';
    }
    setPointFormErrors(errors as Partial<PointFormData>);
    return Object.keys(errors).length === 0;
  };

  const handleSavePoint = async () => {
    if (!validatePointForm() || !id) return;

    setIsSaving(true);
    try {
      let clientId = pointFormData.clientId;

      // Si nouveau client, le créer d'abord
      if (pointFormData.isNewClient && !selectedPoint) {
        const newClient = await clientsService.create({
          nom: pointFormData.newClientNom,
          adresse: pointFormData.newClientAdresse,
          codePostal: pointFormData.newClientCodePostal,
          ville: pointFormData.newClientVille,
          telephone: pointFormData.newClientTelephone || undefined,
        });
        clientId = newClient.id;
        // Rafraîchir la liste des clients
        fetchClients();
      }

      if (selectedPoint) {
        // Mettre à jour le client
        await clientsService.update(selectedPoint.clientId, {
          nom: pointFormData.editClientNom,
          email: pointFormData.editClientEmail || undefined,
          telephone: pointFormData.editClientTelephone || undefined,
          adresse: pointFormData.editClientAdresse,
          complementAdresse: pointFormData.editClientComplementAdresse || undefined,
          codePostal: pointFormData.editClientCodePostal,
          ville: pointFormData.editClientVille,
          instructionsAcces: pointFormData.editClientInstructionsAcces || undefined,
          contactNom: pointFormData.editClientContactNom || undefined,
          contactTelephone: pointFormData.editClientContactTelephone || undefined,
        });

        // Mettre à jour le point
        await tourneesService.updatePoint(id, selectedPoint.id, {
          type: pointFormData.type,
          creneauDebut: pointFormData.creneauDebut || undefined,
          creneauFin: pointFormData.creneauFin || undefined,
          dureePrevue: pointFormData.dureePrevue,
          notesInternes: pointFormData.notesInternes || undefined,
          notesClient: pointFormData.notesClient || undefined,
        });

        // Rafraîchir la liste des clients
        fetchClients();
        success('Point et client modifiés');
      } else {
        await tourneesService.addPoint(id, {
          clientId,
          type: pointFormData.type,
          creneauDebut: pointFormData.creneauDebut || undefined,
          creneauFin: pointFormData.creneauFin || undefined,
          dureePrevue: pointFormData.dureePrevue,
          notesInternes: pointFormData.notesInternes || undefined,
          notesClient: pointFormData.notesClient || undefined,
          produits: pointFormData.produits.length > 0 ? pointFormData.produits : undefined,
        });
        success(pointFormData.isNewClient ? 'Client créé et point ajouté' : 'Point ajouté');
      }
      setIsPointModalOpen(false);
      fetchTournee();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePoint = async () => {
    if (!selectedPoint || !id) return;

    setIsSaving(true);
    try {
      await tourneesService.deletePoint(id, selectedPoint.id);
      success('Point supprimé');
      setIsDeletePointDialogOpen(false);
      fetchTournee();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const openStatusDialog = (action: 'start' | 'finish' | 'cancel') => {
    setStatusAction(action);
    setIsStatusDialogOpen(true);
  };

  const handleStatusChange = async () => {
    if (!id || !statusAction) return;

    setIsSaving(true);
    try {
      let result: Tournee;
      switch (statusAction) {
        case 'start':
          result = await tourneesService.start(id);
          success('Tournée démarrée');
          break;
        case 'finish':
          result = await tourneesService.finish(id);
          success('Tournée terminée');
          break;
        case 'cancel':
          result = await tourneesService.cancel(id);
          success('Tournée annulée');
          break;
        default:
          return;
      }
      setTournee(result);
      setIsStatusDialogOpen(false);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTournee = async () => {
    if (!id) return;

    setIsSaving(true);
    try {
      await tourneesService.delete(id);
      success('Tournée supprimée');
      navigate('/planning');
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const addProduitToForm = () => {
    setPointFormData({
      ...pointFormData,
      produits: [...pointFormData.produits, { produitId: '', quantite: 1 }],
    });
  };

  const removeProduitFromForm = (index: number) => {
    setPointFormData({
      ...pointFormData,
      produits: pointFormData.produits.filter((_, i) => i !== index),
    });
  };

  const updateProduitInForm = (index: number, field: 'produitId' | 'quantite', value: string | number) => {
    const newProduits = [...pointFormData.produits];
    newProduits[index] = { ...newProduits[index], [field]: value };
    setPointFormData({ ...pointFormData, produits: newProduits });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!tournee) {
    return null;
  }

  const statutConfig = getStatutConfig(tournee.statut);
  const canEdit = tournee.statut === 'planifiee';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/planning')}>
            <ArrowLeftIcon className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {format(parseISO(tournee.date), 'EEEE d MMMM yyyy', { locale: fr })}
              </h1>
              <Badge variant={statutConfig.variant}>{statutConfig.label}</Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-gray-500">
              <span className="flex items-center">
                <TruckIcon className="h-4 w-4 mr-1" />
                {tournee.chauffeur
                  ? `${tournee.chauffeur.prenom} ${tournee.chauffeur.nom}`
                  : 'Non assigné'}
              </span>
              {tournee.heureDepart && (
                <span className="flex items-center">
                  <ClockIcon className="h-4 w-4 mr-1" />
                  Départ: {formatTime(tournee.heureDepart)}
                </span>
              )}
              <span className="flex items-center">
                <MapPinIcon className="h-4 w-4 mr-1" />
                {points.length} point{points.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {tournee.statut === 'planifiee' && (
            <>
              <Button
                variant="ghost"
                onClick={() => setIsDeleteTourneeDialogOpen(true)}
                title="Supprimer la tournée"
              >
                <TrashIcon className="h-5 w-5 text-red-500" />
              </Button>
              <Button variant="secondary" onClick={handleOptimize} isLoading={isOptimizing}>
                <BoltIcon className="h-5 w-5 mr-2" />
                Optimiser
              </Button>
              <Button onClick={() => openStatusDialog('start')}>
                <PlayIcon className="h-5 w-5 mr-2" />
                Valider
              </Button>
            </>
          )}
          {tournee.statut === 'en_cours' && (
            <>
              <Button variant="danger" onClick={() => openStatusDialog('cancel')}>
                <XMarkIcon className="h-5 w-5 mr-2" />
                Annuler
              </Button>
              <Button onClick={() => openStatusDialog('finish')}>
                <CheckIcon className="h-5 w-5 mr-2" />
                Terminer
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      {tournee.distanceTotaleKm && (
        <div className="grid grid-cols-4 gap-4">
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">
              {tournee.distanceTotaleKm.toFixed(1)} km
            </p>
            <p className="text-sm text-gray-500">Distance totale</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">
              {tournee.dureeTotaleMin
                ? `${Math.floor(tournee.dureeTotaleMin / 60)}h${String(tournee.dureeTotaleMin % 60).padStart(2, '0')}`
                : '-'}
            </p>
            <p className="text-sm text-gray-500">Durée estimée</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{points.length}</p>
            <p className="text-sm text-gray-500">Points</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">
              {tournee.heureFinEstimee ? formatTime(tournee.heureFinEstimee) : '-'}
            </p>
            <p className="text-sm text-gray-500">Fin estimée</p>
          </Card>
        </div>
      )}

      {/* Map and Points */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Map */}
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">Carte</h2>
          <RouteMap
            points={points}
            depot={
              tournee.depotLatitude && tournee.depotLongitude
                ? {
                    latitude: tournee.depotLatitude,
                    longitude: tournee.depotLongitude,
                    adresse: tournee.depotAdresse,
                  }
                : undefined
            }
            selectedPointId={selectedPointId}
            onPointClick={(point) => setSelectedPointId(point.id)}
            className="h-[500px]"
          />
        </Card>

        {/* Points List */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Points de passage</h2>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={fetchTournee}>
                <ArrowPathIcon className="h-4 w-4" />
              </Button>
              {canEdit && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setIsImportModalOpen(true)}>
                    <DocumentArrowUpIcon className="h-4 w-4 mr-1" />
                    Importer
                  </Button>
                  <Button size="sm" onClick={openAddPointModal}>
                    <PlusIcon className="h-4 w-4 mr-1" />
                    Ajouter
                  </Button>
                </>
              )}
            </div>
          </div>

          {points.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <MapPinIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Aucun point de passage</p>
              {canEdit && (
                <Button variant="secondary" className="mt-4" onClick={openAddPointModal}>
                  Ajouter un point
                </Button>
              )}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={[...points].sort((a, b) => a.ordre - b.ordre).map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2 max-h-[460px] overflow-y-auto">
                  {[...points]
                    .sort((a, b) => a.ordre - b.ordre)
                    .map((point, index) => (
                      <SortablePointCard
                        key={point.id}
                        point={point}
                        index={index}
                        isSelected={point.id === selectedPointId}
                        canDrag={canEdit}
                        onClick={() => setSelectedPointId(point.id)}
                        onEdit={() => openEditPointModal(point)}
                        onDelete={() => openDeletePointDialog(point)}
                      />
                    ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </Card>
      </div>

      {/* Add/Edit Point Modal */}
      <Modal
        isOpen={isPointModalOpen}
        onClose={() => setIsPointModalOpen(false)}
        title={selectedPoint ? 'Modifier le point' : 'Ajouter un point'}
        size="lg"
      >
        <div className="space-y-4">
          {!selectedPoint && (
            <div className="space-y-4">
              {/* Toggle client existant / nouveau */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="clientType"
                    checked={!pointFormData.isNewClient}
                    onChange={() => setPointFormData({ ...pointFormData, isNewClient: false, clientId: '' })}
                    className="text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Client existant</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="clientType"
                    checked={pointFormData.isNewClient}
                    onChange={() => setPointFormData({ ...pointFormData, isNewClient: true, clientId: '' })}
                    className="text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Nouveau client</span>
                </label>
              </div>

              {/* Sélection client existant */}
              {!pointFormData.isNewClient && (
                <SearchableSelect
                  label="Client"
                  value={pointFormData.clientId}
                  onChange={(value) => setPointFormData({ ...pointFormData, clientId: value })}
                  options={clients.map((c) => ({
                    value: c.id,
                    label: `${c.nom} - ${c.adresse}, ${c.ville}`,
                  }))}
                  placeholder="Rechercher un client..."
                  error={pointFormErrors.clientId}
                  required
                />
              )}

              {/* Formulaire nouveau client */}
              {pointFormData.isNewClient && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <Input
                    label="Nom du client"
                    value={pointFormData.newClientNom}
                    onChange={(e) => setPointFormData({ ...pointFormData, newClientNom: e.target.value })}
                    placeholder="Ex: Société Dupont, Marie Martin..."
                    error={pointFormErrors.newClientNom as string}
                    required
                  />
                  <Input
                    label="Adresse"
                    value={pointFormData.newClientAdresse}
                    onChange={(e) => setPointFormData({ ...pointFormData, newClientAdresse: e.target.value })}
                    placeholder="Numéro et rue"
                    error={pointFormErrors.newClientAdresse as string}
                    required
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Code postal"
                      value={pointFormData.newClientCodePostal}
                      onChange={(e) => setPointFormData({ ...pointFormData, newClientCodePostal: e.target.value })}
                      placeholder="75001"
                      error={pointFormErrors.newClientCodePostal as string}
                      required
                    />
                    <Input
                      label="Ville"
                      value={pointFormData.newClientVille}
                      onChange={(e) => setPointFormData({ ...pointFormData, newClientVille: e.target.value })}
                      placeholder="Paris"
                      error={pointFormErrors.newClientVille as string}
                      required
                    />
                  </div>
                  <Input
                    label="Téléphone"
                    value={pointFormData.newClientTelephone}
                    onChange={(e) => setPointFormData({ ...pointFormData, newClientTelephone: e.target.value })}
                    placeholder="06 12 34 56 78"
                  />
                  <p className="text-xs text-gray-500">
                    Ce client sera automatiquement ajouté à votre liste de clients.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Édition client existant */}
          {selectedPoint && (
            <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h3 className="text-sm font-semibold text-blue-800 mb-3">Informations du client</h3>
              <Input
                label="Nom du client"
                value={pointFormData.editClientNom}
                onChange={(e) => setPointFormData({ ...pointFormData, editClientNom: e.target.value })}
                placeholder="Nom du client"
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Email"
                  type="email"
                  value={pointFormData.editClientEmail}
                  onChange={(e) => setPointFormData({ ...pointFormData, editClientEmail: e.target.value })}
                  placeholder="email@exemple.com"
                />
                <Input
                  label="Téléphone"
                  value={pointFormData.editClientTelephone}
                  onChange={(e) => setPointFormData({ ...pointFormData, editClientTelephone: e.target.value })}
                  placeholder="06 12 34 56 78"
                />
              </div>
              <Input
                label="Adresse"
                value={pointFormData.editClientAdresse}
                onChange={(e) => setPointFormData({ ...pointFormData, editClientAdresse: e.target.value })}
                placeholder="Numéro et rue"
                required
              />
              <Input
                label="Complément d'adresse"
                value={pointFormData.editClientComplementAdresse}
                onChange={(e) => setPointFormData({ ...pointFormData, editClientComplementAdresse: e.target.value })}
                placeholder="Bâtiment, étage, etc."
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Code postal"
                  value={pointFormData.editClientCodePostal}
                  onChange={(e) => setPointFormData({ ...pointFormData, editClientCodePostal: e.target.value })}
                  placeholder="75001"
                  required
                />
                <Input
                  label="Ville"
                  value={pointFormData.editClientVille}
                  onChange={(e) => setPointFormData({ ...pointFormData, editClientVille: e.target.value })}
                  placeholder="Paris"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Instructions d'accès
                </label>
                <textarea
                  value={pointFormData.editClientInstructionsAcces}
                  onChange={(e) => setPointFormData({ ...pointFormData, editClientInstructionsAcces: e.target.value })}
                  rows={2}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Code porte, interphone, etc."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Nom du contact"
                  value={pointFormData.editClientContactNom}
                  onChange={(e) => setPointFormData({ ...pointFormData, editClientContactNom: e.target.value })}
                  placeholder="Prénom Nom"
                />
                <Input
                  label="Téléphone du contact"
                  value={pointFormData.editClientContactTelephone}
                  onChange={(e) => setPointFormData({ ...pointFormData, editClientContactTelephone: e.target.value })}
                  placeholder="06 12 34 56 78"
                />
              </div>
            </div>
          )}

          <Select
            label="Type"
            value={pointFormData.type}
            onChange={(e) => setPointFormData({ ...pointFormData, type: e.target.value as PointType })}
            options={[
              { value: 'livraison', label: 'Livraison' },
              { value: 'ramassage', label: 'Ramassage' },
              { value: 'livraison_ramassage', label: 'Livraison + Ramassage' },
            ]}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <TimeSelect
              label="Créneau début"
              value={pointFormData.creneauDebut}
              onChange={(value) => setPointFormData({ ...pointFormData, creneauDebut: value })}
            />
            <TimeSelect
              label="Créneau fin"
              value={pointFormData.creneauFin}
              onChange={(value) => setPointFormData({ ...pointFormData, creneauFin: value })}
            />
          </div>

          <Input
            label="Durée prévue (minutes)"
            type="number"
            min="5"
            max="480"
            value={pointFormData.dureePrevue}
            onChange={(e) => setPointFormData({ ...pointFormData, dureePrevue: parseInt(e.target.value) || 30 })}
          />

          {/* Produits */}
          {!selectedPoint && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Produits</label>
                <Button variant="ghost" size="sm" onClick={addProduitToForm}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Ajouter
                </Button>
              </div>
              {pointFormData.produits.map((p, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <Select
                    value={p.produitId}
                    onChange={(e) => updateProduitInForm(index, 'produitId', e.target.value)}
                    options={[
                      { value: '', label: 'Sélectionner' },
                      ...produits.map((prod) => ({
                        value: prod.id,
                        label: prod.nom,
                      })),
                    ]}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min="1"
                    value={p.quantite}
                    onChange={(e) => updateProduitInForm(index, 'quantite', parseInt(e.target.value) || 1)}
                    className="w-20"
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeProduitFromForm(index)}>
                    <XMarkIcon className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes internes
            </label>
            <textarea
              value={pointFormData.notesInternes}
              onChange={(e) => setPointFormData({ ...pointFormData, notesInternes: e.target.value })}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Notes visibles par l'équipe..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes client
            </label>
            <textarea
              value={pointFormData.notesClient}
              onChange={(e) => setPointFormData({ ...pointFormData, notesClient: e.target.value })}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Instructions pour le client..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsPointModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSavePoint} isLoading={isSaving}>
              {selectedPoint ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Point Confirmation */}
      <ConfirmDialog
        isOpen={isDeletePointDialogOpen}
        onClose={() => setIsDeletePointDialogOpen(false)}
        onConfirm={handleDeletePoint}
        title="Supprimer le point"
        message={`Êtes-vous sûr de vouloir supprimer ce point chez "${selectedPoint?.client?.nom}" ?`}
        confirmText="Supprimer"
        isLoading={isSaving}
      />

      {/* Status Change Confirmation */}
      <ConfirmDialog
        isOpen={isStatusDialogOpen}
        onClose={() => setIsStatusDialogOpen(false)}
        onConfirm={handleStatusChange}
        title={
          statusAction === 'start'
            ? 'Valider la tournée'
            : statusAction === 'finish'
            ? 'Terminer la tournée'
            : 'Annuler la tournée'
        }
        message={
          statusAction === 'start'
            ? 'Confirmez-vous la validation de cette tournée ?'
            : statusAction === 'finish'
            ? 'Confirmez-vous que cette tournée est terminée ?'
            : 'Êtes-vous sûr de vouloir annuler cette tournée ?'
        }
        confirmText={
          statusAction === 'start'
            ? 'Valider'
            : statusAction === 'finish'
            ? 'Terminer'
            : 'Annuler'
        }
        variant={statusAction === 'cancel' ? 'danger' : 'warning'}
        isLoading={isSaving}
      />

      {/* Delete Tournee Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteTourneeDialogOpen}
        onClose={() => setIsDeleteTourneeDialogOpen(false)}
        onConfirm={handleDeleteTournee}
        title="Supprimer la tournée"
        message="Êtes-vous sûr de vouloir supprimer cette tournée ? Cette action est irréversible et supprimera également tous les points associés."
        confirmText="Supprimer"
        variant="danger"
        isLoading={isSaving}
      />

      {/* Import Excel Modal */}
      {id && (
        <ImportExcelModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          tourneeId={id}
          onSuccess={fetchTournee}
        />
      )}
    </div>
  );
}

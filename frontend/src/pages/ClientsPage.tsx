import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Input, Badge, Modal, PhoneNumbers } from '@/components/ui';
import DataTable, { Column } from '@/components/ui/DataTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { clientsService } from '@/services/clients.service';
import { useToast } from '@/hooks/useToast';
import { Client, PaginationMeta } from '@/types';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';

interface ClientFormData {
  nom: string;
  email: string;
  telephone: string;
  adresse: string;
  complementAdresse: string;
  codePostal: string;
  ville: string;
  pays: string;
  instructionsAcces: string;
  contactNom: string;
  contactTelephone: string;
}

const initialFormData: ClientFormData = {
  nom: '',
  email: '',
  telephone: '',
  adresse: '',
  complementAdresse: '',
  codePostal: '',
  ville: '',
  pays: 'France',
  instructionsAcces: '',
  contactNom: '',
  contactTelephone: '',
};

export default function ClientsPage() {
  const { success, error: showError } = useToast();

  const [clients, setClients] = useState<Client[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState<ClientFormData>(initialFormData);
  const [formErrors, setFormErrors] = useState<Partial<ClientFormData>>({});
  const [isSaving, setIsSaving] = useState(false);

  const fetchClients = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const filters: Record<string, unknown> = { page, limit: 20 };
      if (debouncedSearch) filters.search = debouncedSearch;

      const result = await clientsService.list(filters);
      setClients(result.data);
      setMeta(result.meta);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, showError]);

  // Debounce de la recherche
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const openCreateModal = () => {
    setSelectedClient(null);
    setFormData(initialFormData);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setSelectedClient(client);
    setFormData({
      nom: client.nom,
      email: client.email || '',
      telephone: client.telephone || '',
      adresse: client.adresse,
      complementAdresse: client.complementAdresse || '',
      codePostal: client.codePostal,
      ville: client.ville,
      pays: client.pays,
      instructionsAcces: client.instructionsAcces || '',
      contactNom: client.contactNom || '',
      contactTelephone: client.contactTelephone || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openDeleteDialog = (client: Client) => {
    setSelectedClient(client);
    setIsDeleteDialogOpen(true);
  };

  const validateForm = () => {
    const errors: Partial<ClientFormData> = {};

    if (!formData.nom) errors.nom = 'Nom requis';
    if (!formData.adresse) errors.adresse = 'Adresse requise';
    if (!formData.codePostal) errors.codePostal = 'Code postal requis';
    if (!formData.ville) errors.ville = 'Ville requise';

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const data = {
        nom: formData.nom,
        email: formData.email || undefined,
        telephone: formData.telephone || undefined,
        adresse: formData.adresse,
        complementAdresse: formData.complementAdresse || undefined,
        codePostal: formData.codePostal,
        ville: formData.ville,
        pays: formData.pays,
        instructionsAcces: formData.instructionsAcces || undefined,
        contactNom: formData.contactNom || undefined,
        contactTelephone: formData.contactTelephone || undefined,
      };

      if (selectedClient) {
        await clientsService.update(selectedClient.id, data);
        success('Client modifié');
      } else {
        await clientsService.create(data);
        success('Client créé');
      }
      setIsModalOpen(false);
      fetchClients();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedClient) return;

    setIsSaving(true);
    try {
      await clientsService.delete(selectedClient.id);
      success('Client désactivé');
      setIsDeleteDialogOpen(false);
      fetchClients();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const columns: Column<Client>[] = [
    {
      key: 'nom',
      header: 'Client',
      render: (client) => (
        <div>
          <p className="font-medium">{client.nom}</p>
          <p className="text-sm text-gray-500">{client.email || '-'}</p>
        </div>
      ),
    },
    {
      key: 'adresse',
      header: 'Adresse',
      render: (client) => (
        <div>
          <p>{client.adresse}</p>
          <p className="text-sm text-gray-500">
            {client.codePostal} {client.ville}
          </p>
        </div>
      ),
    },
    {
      key: 'telephone',
      header: 'Téléphone',
      render: (client) => client.telephone ? (
        <PhoneNumbers phones={client.telephone} variant="compact" size="sm" />
      ) : '-',
    },
    {
      key: 'actif',
      header: 'Statut',
      render: (client) => (
        <Badge variant={client.actif ? 'success' : 'danger'}>
          {client.actif ? 'Actif' : 'Inactif'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (client) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(client);
            }}
          >
            <PencilIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openDeleteDialog(client);
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
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500">Gérez vos clients et lieux de livraison</p>
        </div>
        <Button onClick={openCreateModal}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Nouveau client
        </Button>
      </div>

      <Card>
        <div className="mb-6">
          <Input
            placeholder="Rechercher par nom, adresse, ville..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <DataTable
          columns={columns}
          data={clients}
          keyExtractor={(client) => client.id}
          isLoading={isLoading}
          emptyMessage="Aucun client trouvé"
          pagination={{
            page: meta.page,
            limit: meta.limit,
            total: meta.total,
            onPageChange: fetchClients,
          }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedClient ? 'Modifier le client' : 'Nouveau client'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nom / Raison sociale"
            value={formData.nom}
            onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
            error={formErrors.nom}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
            <Input
              label="Téléphone"
              type="tel"
              value={formData.telephone}
              onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
            />
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-900 mb-3 flex items-center">
              <MapPinIcon className="h-5 w-5 mr-2" />
              Adresse
            </h4>
            <Input
              label="Adresse"
              value={formData.adresse}
              onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
              error={formErrors.adresse}
              required
            />
            <div className="mt-4">
              <Input
                label="Complément d'adresse"
                value={formData.complementAdresse}
                onChange={(e) => setFormData({ ...formData, complementAdresse: e.target.value })}
                placeholder="Bâtiment, étage, code..."
              />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <Input
                label="Code postal"
                value={formData.codePostal}
                onChange={(e) => setFormData({ ...formData, codePostal: e.target.value })}
                error={formErrors.codePostal}
                required
              />
              <Input
                label="Ville"
                value={formData.ville}
                onChange={(e) => setFormData({ ...formData, ville: e.target.value })}
                error={formErrors.ville}
                required
              />
              <Input
                label="Pays"
                value={formData.pays}
                onChange={(e) => setFormData({ ...formData, pays: e.target.value })}
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-900 mb-3">Contact sur place</h4>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Nom du contact"
                value={formData.contactNom}
                onChange={(e) => setFormData({ ...formData, contactNom: e.target.value })}
              />
              <div>
                <Input
                  label="Téléphone du contact"
                  type="tel"
                  value={formData.contactTelephone}
                  onChange={(e) => setFormData({ ...formData, contactTelephone: e.target.value })}
                  placeholder="06 12 34 56 78"
                />
                <p className="mt-1 text-xs text-gray-500">
                  💡 Vous pouvez saisir plusieurs numéros séparés par , / - ou espace
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instructions d'accès
            </label>
            <textarea
              value={formData.instructionsAcces}
              onChange={(e) => setFormData({ ...formData, instructionsAcces: e.target.value })}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
              placeholder="Instructions particulières pour l'accès..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} isLoading={isSaving}>
              {selectedClient ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Désactiver le client"
        message={`Êtes-vous sûr de vouloir désactiver "${selectedClient?.nom}" ? Le client ne sera plus disponible pour les nouvelles tournées.`}
        confirmText="Désactiver"
        isLoading={isSaving}
      />
    </div>
  );
}

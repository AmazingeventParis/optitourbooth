import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Card, Input, Select, Badge, Modal } from '@/components/ui';
import DataTable, { Column } from '@/components/ui/DataTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { usersService } from '@/services/users.service';
import { useToast } from '@/hooks/useToast';
import { User, PaginationMeta } from '@/types';
import { PlusIcon, MagnifyingGlassIcon, PencilIcon, TrashIcon, CameraIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Avatar from '@/components/ui/Avatar';
import { useAuthStore } from '@/store/authStore';

interface UserFormData {
  email: string;
  password: string;
  nom: string;
  prenom: string;
  role: 'admin' | 'chauffeur';
  telephone: string;
  couleur: string;
}

// Couleurs prédéfinies pour les chauffeurs
const PRESET_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
  '#EF4444', // red
  '#84CC16', // lime
  '#06B6D4', // cyan
  '#A855F7', // fuchsia
];

const initialFormData: UserFormData = {
  email: '',
  password: '',
  nom: '',
  prenom: '',
  role: 'chauffeur',
  telephone: '',
  couleur: '#3B82F6',
};

export default function UsersPage() {
  const { success, error: showError } = useToast();
  const { user: authUser, setUser: setAuthUser } = useAuthStore();

  const [users, setUsers] = useState<User[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [formErrors, setFormErrors] = useState<Partial<UserFormData>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const fetchUsers = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const filters: Record<string, unknown> = { page, limit: 20 };
      if (search) filters.search = search;
      if (roleFilter) filters.role = roleFilter;

      const result = await usersService.list(filters);
      setUsers(result.data);
      setMeta(result.meta);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [search, roleFilter, showError]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers(1);
  };

  const openCreateModal = () => {
    setSelectedUser(null);
    setFormData(initialFormData);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setFormData({
      email: user.email,
      password: '',
      nom: user.nom,
      prenom: user.prenom,
      role: user.role,
      telephone: user.telephone || '',
      couleur: user.couleur || '#3B82F6',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openDeleteDialog = (user: User) => {
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedUser || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setIsUploadingAvatar(true);
    try {
      const updated = await usersService.uploadAvatar(selectedUser.id, file);
      setSelectedUser(updated);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, avatarUrl: updated.avatarUrl } : u)));
      if (authUser && authUser.id === updated.id) {
        setAuthUser({ ...authUser, avatarUrl: updated.avatarUrl });
      }
      success('Photo mise à jour');
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsUploadingAvatar(false);
      e.target.value = '';
    }
  };

  const handleAvatarDelete = async () => {
    if (!selectedUser) return;
    setIsUploadingAvatar(true);
    try {
      const updated = await usersService.deleteAvatar(selectedUser.id);
      setSelectedUser(updated);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, avatarUrl: undefined } : u)));
      if (authUser && authUser.id === updated.id) {
        setAuthUser({ ...authUser, avatarUrl: undefined });
      }
      success('Photo supprimée');
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const validateForm = () => {
    const errors: Partial<UserFormData> = {};

    if (!formData.email) errors.email = 'Email requis';
    if (!selectedUser && !formData.password) errors.password = 'Mot de passe requis';
    if (formData.password) {
      if (formData.password.length < 8) {
        errors.password = 'Minimum 8 caractères';
      } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
        errors.password = 'Doit contenir majuscule, minuscule et chiffre';
      }
    }
    if (!formData.nom) errors.nom = 'Nom requis';
    if (!formData.prenom) errors.prenom = 'Prénom requis';

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      if (selectedUser) {
        const updateData: Record<string, unknown> = {
          email: formData.email,
          nom: formData.nom,
          prenom: formData.prenom,
          role: formData.role,
          telephone: formData.telephone || null,
          couleur: formData.couleur || null,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        await usersService.update(selectedUser.id, updateData);
        success('Utilisateur modifié');
      } else {
        await usersService.create(formData);
        success('Utilisateur créé');
      }
      setIsModalOpen(false);
      fetchUsers();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;

    setIsSaving(true);
    try {
      await usersService.delete(selectedUser.id);
      success('Utilisateur supprimé');
      setIsDeleteDialogOpen(false);
      fetchUsers();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'nom',
      header: 'Nom',
      render: (user) => (
        <div className="flex items-center gap-3">
          <Avatar user={user} size="sm" />
          <div>
            <p className="font-medium">{user.prenom} {user.nom}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Rôle',
      render: (user) => (
        <Badge variant={user.role === 'admin' ? 'info' : 'default'}>
          {user.role === 'admin' ? 'Admin' : 'Chauffeur'}
        </Badge>
      ),
    },
    {
      key: 'telephone',
      header: 'Téléphone',
      render: (user) => user.telephone || '-',
    },
    {
      key: 'actif',
      header: 'Statut',
      render: (user) => (
        <Badge variant={user.actif ? 'success' : 'danger'}>
          {user.actif ? 'Actif' : 'Inactif'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (user) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(user);
            }}
          >
            <PencilIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openDeleteDialog(user);
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
          <h1 className="text-2xl font-bold text-gray-900">Utilisateurs</h1>
          <p className="text-gray-500">Gérez les administrateurs et chauffeurs</p>
        </div>
        <Button onClick={openCreateModal}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Nouvel utilisateur
        </Button>
      </div>

      <Card>
        <form onSubmit={handleSearch} className="flex gap-4 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Rechercher par nom, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            options={[
              { value: '', label: 'Tous les rôles' },
              { value: 'admin', label: 'Admin' },
              { value: 'chauffeur', label: 'Chauffeur' },
            ]}
          />
          <Button type="submit" variant="secondary">
            <MagnifyingGlassIcon className="h-5 w-5" />
          </Button>
        </form>

        <DataTable
          columns={columns}
          data={users}
          keyExtractor={(user) => user.id}
          isLoading={isLoading}
          emptyMessage="Aucun utilisateur trouvé"
          pagination={{
            page: meta.page,
            limit: meta.limit,
            total: meta.total,
            onPageChange: fetchUsers,
          }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
      >
        <div className="space-y-4">
          {/* Avatar upload (edit mode only) */}
          {selectedUser && (
            <div className="flex flex-col items-center gap-2 pb-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarUpload}
                disabled={isUploadingAvatar}
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="relative group rounded-full cursor-pointer"
              >
                <Avatar
                  user={{ ...selectedUser, couleur: formData.couleur }}
                  size="lg"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  {isUploadingAvatar ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  ) : (
                    <CameraIcon className="h-6 w-6 text-white" />
                  )}
                </div>
              </button>
              {selectedUser.avatarUrl && (
                <button
                  type="button"
                  onClick={handleAvatarDelete}
                  disabled={isUploadingAvatar}
                  className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                >
                  <XMarkIcon className="h-3 w-3" />
                  Supprimer la photo
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Prénom"
              value={formData.prenom}
              onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
              error={formErrors.prenom}
              required
            />
            <Input
              label="Nom"
              value={formData.nom}
              onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
              error={formErrors.nom}
              required
            />
          </div>
          <Input
            label="Email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            error={formErrors.email}
            required
          />
          <Input
            label={selectedUser ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            error={formErrors.password}
            placeholder="Min. 8 caractères, majuscule, minuscule, chiffre"
            required={!selectedUser}
          />
          <Select
            label="Rôle"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'chauffeur' })}
            options={[
              { value: 'chauffeur', label: 'Chauffeur' },
              { value: 'admin', label: 'Administrateur' },
            ]}
            required
          />
          <Input
            label="Téléphone"
            type="tel"
            value={formData.telephone}
            onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
          />

          {/* Sélecteur de couleur */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Couleur (pour les tournées)
            </label>
            <div className="flex items-center gap-3">
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormData({ ...formData, couleur: color })}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      formData.couleur === color
                        ? 'border-gray-900 scale-110 ring-2 ring-offset-2 ring-gray-400'
                        : 'border-transparent hover:border-gray-300'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="color"
                  value={formData.couleur}
                  onChange={(e) => setFormData({ ...formData, couleur: e.target.value })}
                  className="w-10 h-10 rounded cursor-pointer border border-gray-300"
                  title="Couleur personnalisée"
                />
                <span className="text-sm text-gray-500">{formData.couleur}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} isLoading={isSaving}>
              {selectedUser ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Supprimer l'utilisateur"
        message={`Êtes-vous sûr de vouloir supprimer définitivement ${selectedUser?.prenom} ${selectedUser?.nom} ? Cette action est irréversible.`}
        confirmText="Supprimer"
        variant="danger"
        isLoading={isSaving}
      />
    </div>
  );
}

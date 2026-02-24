import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Input, Select, Badge, Modal } from '@/components/ui';
import DataTable, { Column } from '@/components/ui/DataTable';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { tenantsService } from '@/services/tenants.service';
import { useToast } from '@/hooks/useToast';
import { Tenant, TenantPlan, PaginationMeta } from '@/types';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  NoSymbolIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';

interface TenantFormData {
  name: string;
  slug: string;
  plan: TenantPlan;
  active: boolean;
}

interface AdminFormData {
  email: string;
  password: string;
  nom: string;
  prenom: string;
  telephone: string;
}

const initialFormData: TenantFormData = {
  name: '',
  slug: '',
  plan: 'STARTER',
  active: true,
};

const initialAdminFormData: AdminFormData = {
  email: '',
  password: '',
  nom: '',
  prenom: '',
  telephone: '',
};

const PLAN_OPTIONS = [
  { value: 'STARTER', label: 'Starter' },
  { value: 'PRO', label: 'Pro' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
];

const PLAN_COLORS: Record<TenantPlan, 'default' | 'info' | 'warning'> = {
  STARTER: 'default',
  PRO: 'info',
  ENTERPRISE: 'warning',
};

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

export default function SuperAdminTenantsPage() {
  const { success, error: showError } = useToast();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeactivateDialogOpen, setIsDeactivateDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [formData, setFormData] = useState<TenantFormData>(initialFormData);
  const [adminFormData, setAdminFormData] = useState<AdminFormData>(initialAdminFormData);
  const [formErrors, setFormErrors] = useState<Partial<Record<string, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showAdminSection, setShowAdminSection] = useState(true);

  const fetchTenants = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const filters: Record<string, unknown> = { page, limit: 20 };
      if (search) filters.search = search;

      const result = await tenantsService.list(filters);
      setTenants(result.data);
      setMeta(result.meta);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [search, showError]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTenants(1);
  };

  const openCreateModal = () => {
    setSelectedTenant(null);
    setFormData(initialFormData);
    setAdminFormData(initialAdminFormData);
    setFormErrors({});
    setShowPassword(false);
    setShowAdminSection(true);
    setIsModalOpen(true);
  };

  const openEditModal = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setFormData({
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      active: tenant.active,
    });
    setFormErrors({});
    setShowAdminSection(false);
    setIsModalOpen(true);
  };

  const openDeactivateDialog = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setIsDeactivateDialogOpen(true);
  };

  const handleNameChange = (value: string) => {
    const newFormData = { ...formData, name: value };
    // Auto-generate slug only in creation mode and if slug hasn't been manually edited
    if (!selectedTenant && (formData.slug === '' || formData.slug === slugify(formData.name))) {
      newFormData.slug = slugify(value);
    }
    setFormData(newFormData);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.name) errors.name = 'Nom requis';
    if (!formData.slug) errors.slug = 'Slug requis';
    if (formData.slug && !/^[a-z0-9-]+$/.test(formData.slug)) {
      errors.slug = 'Slug invalide (lettres minuscules, chiffres et tirets)';
    }

    // Validate admin section in creation mode
    if (!selectedTenant && showAdminSection) {
      if (!adminFormData.email) errors.adminEmail = 'Email requis';
      if (!adminFormData.password) {
        errors.adminPassword = 'Mot de passe requis';
      } else if (adminFormData.password.length < 8) {
        errors.adminPassword = 'Minimum 8 caractères';
      } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(adminFormData.password)) {
        errors.adminPassword = 'Doit contenir majuscule, minuscule et chiffre';
      }
      if (!adminFormData.nom) errors.adminNom = 'Nom requis';
      if (!adminFormData.prenom) errors.adminPrenom = 'Prénom requis';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      if (selectedTenant) {
        // Edit mode
        await tenantsService.update(selectedTenant.id, {
          name: formData.name,
          slug: formData.slug,
          plan: formData.plan,
          active: formData.active,
        });
        success('Tenant mis à jour');
      } else {
        // Create mode
        const tenant = await tenantsService.create({
          name: formData.name,
          slug: formData.slug,
          plan: formData.plan,
          active: formData.active,
        });

        // Create admin if section is filled
        if (showAdminSection && adminFormData.email) {
          await tenantsService.createAdmin(tenant.id, {
            email: adminFormData.email,
            password: adminFormData.password,
            nom: adminFormData.nom,
            prenom: adminFormData.prenom,
            telephone: adminFormData.telephone || undefined,
          });
        }
        success('Tenant créé');
      }
      setIsModalOpen(false);
      fetchTenants();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
      showError('Erreur', errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!selectedTenant) return;

    setIsSaving(true);
    try {
      await tenantsService.delete(selectedTenant.id);
      success('Tenant désactivé');
      setIsDeactivateDialogOpen(false);
      fetchTenants();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const columns: Column<Tenant>[] = [
    {
      key: 'name',
      header: 'Nom',
      render: (tenant) => (
        <div>
          <p className="font-medium">{tenant.name}</p>
          <p className="text-sm text-gray-500">{tenant.slug}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (tenant) => (
        <Badge variant={PLAN_COLORS[tenant.plan]}>
          {tenant.plan}
        </Badge>
      ),
    },
    {
      key: 'users',
      header: 'Utilisateurs',
      render: (tenant) => (
        <span className="text-sm">{tenant._count?.users ?? 0}</span>
      ),
    },
    {
      key: 'active',
      header: 'Statut',
      render: (tenant) => (
        <Badge variant={tenant.active ? 'success' : 'danger'}>
          {tenant.active ? 'Actif' : 'Inactif'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (tenant) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(tenant);
            }}
          >
            <PencilIcon className="h-4 w-4" />
          </Button>
          {tenant.active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openDeactivateDialog(tenant);
              }}
            >
              <NoSymbolIcon className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="text-gray-500">Gérez les organisations clientes</p>
        </div>
        <Button onClick={openCreateModal}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Nouveau tenant
        </Button>
      </div>

      <Card>
        <form onSubmit={handleSearch} className="flex gap-4 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Rechercher par nom, slug..."
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
          data={tenants}
          keyExtractor={(tenant) => tenant.id}
          isLoading={isLoading}
          emptyMessage="Aucun tenant trouvé"
          pagination={{
            page: meta.page,
            limit: meta.limit,
            total: meta.total,
            onPageChange: fetchTenants,
          }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedTenant ? 'Modifier le tenant' : 'Nouveau tenant'}
      >
        <div className="space-y-4">
          <Input
            label="Nom"
            value={formData.name}
            onChange={(e) => handleNameChange(e.target.value)}
            error={formErrors.name}
            required
          />
          <Input
            label="Slug"
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            error={formErrors.slug}
            required
          />
          <Select
            label="Plan"
            value={formData.plan}
            onChange={(e) => setFormData({ ...formData, plan: e.target.value as TenantPlan })}
            options={PLAN_OPTIONS}
          />

          {selectedTenant && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tenant-active"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="tenant-active" className="text-sm text-gray-700">
                Actif
              </label>
            </div>
          )}

          {/* Premier admin section (creation only) */}
          {!selectedTenant && (
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Premier administrateur
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Prénom"
                    value={adminFormData.prenom}
                    onChange={(e) => setAdminFormData({ ...adminFormData, prenom: e.target.value })}
                    error={formErrors.adminPrenom}
                    required
                  />
                  <Input
                    label="Nom"
                    value={adminFormData.nom}
                    onChange={(e) => setAdminFormData({ ...adminFormData, nom: e.target.value })}
                    error={formErrors.adminNom}
                    required
                  />
                </div>
                <Input
                  label="Email"
                  type="email"
                  value={adminFormData.email}
                  onChange={(e) => setAdminFormData({ ...adminFormData, email: e.target.value })}
                  error={formErrors.adminEmail}
                  required
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mot de passe <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={adminFormData.password}
                      onChange={(e) => setAdminFormData({ ...adminFormData, password: e.target.value })}
                      placeholder="Min. 8 caractères, majuscule, minuscule, chiffre"
                      className={`input pr-10 ${formErrors.adminPassword ? 'border-red-500' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? (
                        <EyeSlashIcon className="h-5 w-5" />
                      ) : (
                        <EyeIcon className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {formErrors.adminPassword && (
                    <p className="mt-1 text-sm text-red-600">{formErrors.adminPassword}</p>
                  )}
                </div>
                <Input
                  label="Téléphone"
                  type="tel"
                  value={adminFormData.telephone}
                  onChange={(e) => setAdminFormData({ ...adminFormData, telephone: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} isLoading={isSaving}>
              {selectedTenant ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Deactivate Confirmation */}
      <ConfirmDialog
        isOpen={isDeactivateDialogOpen}
        onClose={() => setIsDeactivateDialogOpen(false)}
        onConfirm={handleDeactivate}
        title="Désactiver le tenant"
        message={`Êtes-vous sûr de vouloir désactiver "${selectedTenant?.name}" ? Les utilisateurs de ce tenant ne pourront plus se connecter.`}
        confirmText="Désactiver"
        variant="danger"
        isLoading={isSaving}
      />
    </div>
  );
}

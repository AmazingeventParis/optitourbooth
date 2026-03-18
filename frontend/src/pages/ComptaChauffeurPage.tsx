import { useState, useEffect, useCallback } from 'react';
import { billingService, UserBillingConfig, BillingEntry, CustomItem } from '@/services/billing.service';
import { Card, Button, Modal, Input } from '@/components/ui';
import {
  PencilIcon,
  TrashIcon,
  PlusIcon,
  CalculatorIcon,
  XMarkIcon,
  BanknotesIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  point_hors_forfait: { label: 'Point HF', color: 'bg-orange-100 text-orange-800' },
  heure_supp: { label: 'Heure supp', color: 'bg-red-100 text-red-800' },
  custom: { label: 'Manuel', color: 'bg-blue-100 text-blue-800' },
};

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

export default function ComptaChauffeurPage() {
  const [section, setSection] = useState<'tarifs' | 'historique'>('tarifs');

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setSection('tarifs')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            section === 'tarifs' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <BanknotesIcon className="h-4 w-4" />
          Grille tarifaire
        </button>
        <button
          onClick={() => setSection('historique')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            section === 'historique' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          <ClockIcon className="h-4 w-4" />
          Historique compta
        </button>
      </div>

      {section === 'tarifs' && <TarifsSection />}
      {section === 'historique' && <HistoriqueSection />}
    </div>
  );
}

// =============================================
// SECTION 1: Grille tarifaire
// =============================================
function TarifsSection() {
  const [configs, setConfigs] = useState<UserBillingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<UserBillingConfig | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await billingService.getConfigs();
      setConfigs(data);
    } catch {
      toast.error('Erreur chargement des configurations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  if (loading) return <div className="text-center py-8 text-gray-500">Chargement...</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Configurez les tarifs pour chaque chauffeur/admin. Les points livrés hors forfait et les heures supplémentaires seront automatiquement calculés.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {configs.map((uc) => (
          <Card key={uc.userId} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: uc.couleur || '#6B7280' }}
                >
                  {uc.prenom[0]}{uc.nom[0]}
                </div>
                <div>
                  <div className="font-semibold text-sm text-gray-900">{uc.prenom} {uc.nom}</div>
                  <div className="text-xs text-gray-400">{uc.roles.join(', ')}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditUser(uc); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors cursor-pointer z-10"
              >
                <PencilIcon className="h-4 w-4" />
              </button>
            </div>

            {uc.config.isIndependent && (
              <div className="mb-2 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs font-medium text-amber-700 text-center">
                Chauffeur indépendant
              </div>
            )}

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Point hors forfait</span>
                <span className="font-semibold">{uc.config.tarifPointHorsForfait} &euro;</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Heure supplémentaire</span>
                <span className="font-semibold">{uc.config.tarifHeureSupp} &euro;/h</span>
              </div>
              {!uc.config.isIndependent && (
              <div className="flex justify-between">
                <span className="text-gray-500">Plage hors forfait</span>
                <span className="font-medium text-orange-600">
                  {uc.config.horsForfaitDebut || '18:00'} &rarr; {uc.config.horsForfaitFin || '07:00'}
                </span>
              </div>
              )}
              {(uc.config.customItems as CustomItem[])?.length > 0 && (
                <div className="pt-1.5 border-t border-gray-100 mt-1.5">
                  <span className="text-gray-400">Tarifs personnalisés :</span>
                  {(uc.config.customItems as CustomItem[]).map((item, i) => (
                    <div key={i} className="flex justify-between mt-0.5">
                      <span className="text-gray-600">{item.name}</span>
                      <span className="font-semibold">{item.price} &euro;</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Edit Modal */}
      {editUser && (
        <EditConfigModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); fetchConfigs(); }}
        />
      )}
    </div>
  );
}

function EditConfigModal({ user, onClose, onSaved }: {
  user: UserBillingConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tarifHF, setTarifHF] = useState(user.config.tarifPointHorsForfait);
  const [tarifHS, setTarifHS] = useState(user.config.tarifHeureSupp);
  const [debut, setDebut] = useState(user.config.horsForfaitDebut || '18:00');
  const [fin, setFin] = useState(user.config.horsForfaitFin || '07:00');
  const [isIndependent, setIsIndependent] = useState(user.config.isIndependent || false);
  const [customItems, setCustomItems] = useState<CustomItem[]>((user.config.customItems as CustomItem[]) || []);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await billingService.upsertConfig(user.userId, {
        tarifPointHorsForfait: tarifHF,
        tarifHeureSupp: tarifHS,
        horsForfaitDebut: debut,
        horsForfaitFin: fin,
        isIndependent,
        customItems,
      });
      toast.success('Configuration sauvegardée');
      onSaved();
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const addCustomItem = () => setCustomItems([...customItems, { name: '', price: 0 }]);
  const removeCustomItem = (idx: number) => setCustomItems(customItems.filter((_, i) => i !== idx));
  const updateCustomItem = (idx: number, field: 'name' | 'price', value: string | number) => {
    const updated = [...customItems];
    updated[idx] = { ...updated[idx]!, [field]: value };
    setCustomItems(updated);
  };

  return (
    <Modal isOpen onClose={onClose} title={`Tarifs - ${user.prenom} ${user.nom}`} size="lg">
      <div className="space-y-4">
        {/* Chauffeur indépendant */}
        <label className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={isIndependent}
            onChange={(e) => setIsIndependent(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
          />
          <div>
            <span className="text-sm font-medium text-amber-800">Chauffeur indépendant</span>
            <p className="text-xs text-amber-600">Tous les points sont facturés hors forfait (pas de plage horaire)</p>
          </div>
        </label>

        {/* Plage hors forfait */}
        {!isIndependent && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Plage horaire hors forfait</label>
          <div className="flex items-center gap-2">
            <select
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="text-gray-400 text-sm">&rarr;</span>
            <select
              value={fin}
              onChange={(e) => setFin(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <p className="text-xs text-gray-400 mt-1">Les points livrés dans cette plage seront facturés en hors forfait</p>
        </div>
        )}

        {/* Tarif point HF */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tarif point hors forfait (&euro;)</label>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={tarifHF}
            onChange={(e) => setTarifHF(parseFloat(e.target.value) || 0)}
          />
        </div>

        {/* Tarif heure supp */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tarif heure supplémentaire (&euro;/h)</label>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={tarifHS}
            onChange={(e) => setTarifHS(parseFloat(e.target.value) || 0)}
          />
        </div>

        {/* Custom items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Tarifs personnalisés</label>
            <button
              onClick={addCustomItem}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Ajouter
            </button>
          </div>
          {customItems.length === 0 && (
            <p className="text-xs text-gray-400">Aucun tarif personnalisé</p>
          )}
          <div className="space-y-2">
            {customItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateCustomItem(idx, 'name', e.target.value)}
                  placeholder="Intitulé"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <input
                  type="number"
                  value={item.price}
                  onChange={(e) => updateCustomItem(idx, 'price', parseFloat(e.target.value) || 0)}
                  min={0}
                  step={0.5}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Prix"
                />
                <span className="text-xs text-gray-400">&euro;</span>
                <button onClick={() => removeCustomItem(idx)} className="p-1 text-red-400 hover:text-red-600">
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================
// SECTION 2: Historique compta
// =============================================
function HistoriqueSection() {
  const [entries, setEntries] = useState<BillingEntry[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 50, total: 0, totalPages: 0, totalSum: 0 });
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<UserBillingConfig[]>([]);

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1); // 1er du mois
    return d.toISOString().substring(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().substring(0, 10));
  const [page, setPage] = useState(1);

  // Add entry modal
  const [addModal, setAddModal] = useState(false);
  const [computing, setComputing] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await billingService.getEntries({
        userId: filterUser || undefined,
        dateFrom,
        dateTo,
        page,
        limit: 50,
      });
      setEntries(res.data);
      setMeta(res.meta);
    } catch {
      toast.error('Erreur chargement historique');
    } finally {
      setLoading(false);
    }
  }, [filterUser, dateFrom, dateTo, page]);

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await billingService.getConfigs();
      setConfigs(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);
  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      const result = await billingService.computeEntries(dateFrom, dateTo, filterUser || undefined);
      toast.success(result.message);
      fetchEntries();
    } catch {
      toast.error('Erreur lors du calcul');
    } finally {
      setComputing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette entrée ?')) return;
    try {
      await billingService.deleteEntry(id);
      toast.success('Entrée supprimée');
      fetchEntries();
    } catch {
      toast.error('Erreur suppression');
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chauffeur</label>
            <select
              value={filterUser}
              onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Tous</option>
              {configs.map((c) => (
                <option key={c.userId} value={c.userId}>{c.prenom} {c.nom}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Du</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Au</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleCompute} disabled={computing}>
            <CalculatorIcon className="h-4 w-4 mr-1.5" />
            {computing ? 'Calcul...' : 'Calculer auto'}
          </Button>
          <Button size="sm" onClick={() => setAddModal(true)}>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            Entrée manuelle
          </Button>
        </div>
      </Card>

      {/* Summary */}
      <div className="flex items-center gap-4">
        <span className="px-4 py-1.5 rounded-full text-base font-semibold bg-primary-100 text-primary-800">
          Total : {meta.totalSum?.toFixed(2) || '0.00'} &euro;
        </span>
        <span className="text-sm text-gray-400">{meta.total} entrée(s)</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Chargement...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <BanknotesIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Aucune entrée comptable pour cette période</p>
          <p className="text-xs mt-1">Utilisez "Calculer auto" pour générer les entrées depuis les tournées</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Chauffeur</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Description</th>
                <th className="pb-2 font-medium text-right">Qté</th>
                <th className="pb-2 font-medium text-right">Prix unit.</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const typeInfo = TYPE_LABELS[entry.type] || { label: entry.type, color: 'bg-gray-100 text-gray-600' };
                return (
                  <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 whitespace-nowrap">
                      {new Date(entry.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        {entry.user && (
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                            style={{ backgroundColor: entry.user.couleur || '#6B7280' }}
                          >
                            {entry.user.prenom[0]}{entry.user.nom[0]}
                          </div>
                        )}
                        <span className="text-gray-900">{entry.user ? `${entry.user.prenom} ${entry.user.nom}` : '-'}</span>
                      </div>
                    </td>
                    <td className="py-2">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', typeInfo.color)}>
                        {typeInfo.label}
                      </span>
                    </td>
                    <td className="py-2 text-gray-600 max-w-xs truncate">{entry.label}</td>
                    <td className="py-2 text-right tabular-nums">{entry.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{entry.unitPrice.toFixed(2)} &euro;</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{entry.totalPrice.toFixed(2)} &euro;</td>
                    <td className="py-2">
                      <button onClick={() => handleDelete(entry.id)} className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Précédent
          </Button>
          <span className="text-sm text-gray-500">Page {page} / {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
            Suivant
          </Button>
        </div>
      )}

      {/* Add Entry Modal */}
      {addModal && (
        <AddEntryModal
          configs={configs}
          onClose={() => setAddModal(false)}
          onCreated={() => { setAddModal(false); fetchEntries(); }}
        />
      )}
    </div>
  );
}

function AddEntryModal({ configs, onClose, onCreated }: {
  configs: UserBillingConfig[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [userId, setUserId] = useState(configs[0]?.userId || '');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [label, setLabel] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [saving, setSaving] = useState(false);

  // Quick-fill from custom items
  const selectedConfig = configs.find((c) => c.userId === userId);
  const customItems = (selectedConfig?.config.customItems as CustomItem[]) || [];

  const handleSave = async () => {
    if (!userId || !label || unitPrice <= 0) {
      toast.error('Remplissez tous les champs');
      return;
    }
    setSaving(true);
    try {
      await billingService.createEntry({ userId, date, label, quantity, unitPrice });
      toast.success('Entrée créée');
      onCreated();
    } catch {
      toast.error('Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Nouvelle entrée comptable">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Chauffeur *</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500">
            {configs.map((c) => (
              <option key={c.userId} value={c.userId}>{c.prenom} {c.nom}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>

        {/* Quick-fill from custom items */}
        {customItems.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pré-remplir depuis tarifs</label>
            <div className="flex flex-wrap gap-1.5">
              {customItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { setLabel(item.name); setUnitPrice(item.price); }}
                  className="px-2.5 py-1 rounded-full text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                >
                  {item.name} ({item.price}&euro;)
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Livraison spéciale week-end" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
            <Input type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.ceil(parseFloat(e.target.value) || 1)))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prix unitaire (&euro;) *</label>
            <Input type="number" min={0} step={0.5} value={unitPrice} onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <span className="text-gray-500">Total :</span>
          <span className="font-bold text-gray-900 ml-2">{(quantity * unitPrice).toFixed(2)} &euro;</span>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Création...' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

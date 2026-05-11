import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  PlusIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { chronopostService, ChronopostExpedition, ChronopostStatut } from '@/services/chronopost.service';
import { useToast } from '@/hooks/useToast';
import clsx from 'clsx';

const STATUT_LABELS: Record<ChronopostStatut, string> = {
  en_preparation: 'En préparation',
  expedie: 'Expédié',
  livre: 'Livré',
  en_retour: 'En retour',
  rentre: 'Rentré',
  probleme: 'Problème',
};

const STATUT_COLORS: Record<ChronopostStatut, string> = {
  en_preparation: 'bg-gray-100 text-gray-700',
  expedie: 'bg-blue-100 text-blue-700',
  livre: 'bg-green-100 text-green-700',
  en_retour: 'bg-yellow-100 text-yellow-700',
  rentre: 'bg-emerald-100 text-emerald-700',
  probleme: 'bg-red-100 text-red-700',
};

const PRODUITS = ['Vegas', 'Smakk', 'Ring', 'Miroir', 'Spinner', 'Aircam', 'Playbox'];

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export default function ChronopostPage() {
  const [expeditions, setExpeditions] = useState<ChronopostExpedition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChronopostExpedition | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingStatut, setSavingStatut] = useState(false);
  const { success, error: showError } = useToast();

  // Form state
  const [formNumeroColis, setFormNumeroColis] = useState('');
  const [formProduit, setFormProduit] = useState('');
  const [formDateRetour, setFormDateRetour] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await chronopostService.list();
      setExpeditions(data);
      if (selected) {
        const refreshed = data.find(e => e.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch {
      showError('Erreur', 'Impossible de charger les expéditions');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { load(); }, []);

  // Calendar logic
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday first
  const daysInMonth = lastDay.getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  function getEventsForDay(day: number) {
    const date = new Date(year, month, day);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const departures = expeditions.filter(e => e.dateDepart && isSameDay(new Date(e.dateDepart), date));
    const returns = expeditions.filter(e => {
      const retourDate = e.dateRetourReel || e.dateRetourPrevu;
      return retourDate && isSameDay(new Date(retourDate), date);
    });
    const overdueReturns = returns.filter(e => {
      if (e.statut === 'rentre') return false;
      if (!e.dateRetourPrevu) return false;
      const d = new Date(e.dateRetourPrevu); d.setHours(0, 0, 0, 0);
      return d < today;
    });
    const normalReturns = returns.filter(e => !overdueReturns.includes(e));
    return { departures, normalReturns, overdueReturns };
  }

  function handleDayClick(day: number) {
    const { departures, normalReturns, overdueReturns } = getEventsForDay(day);
    const all = [...departures, ...normalReturns, ...overdueReturns];
    if (all.length === 0) return;
    if (all.length === 1) { setSelected(all[0]); return; }
    // Multiple: pick first departure, else first return
    setSelected(departures[0] || normalReturns[0] || overdueReturns[0]);
  }

  async function handleCreate() {
    if (!formNumeroColis.trim()) return;
    setFormLoading(true);
    try {
      await chronopostService.create({
        numeroColis: formNumeroColis.trim(),
        produitNom: formProduit || undefined,
        dateRetourPrevu: formDateRetour || undefined,
        notes: formNotes || undefined,
      });
      success('Expédition ajoutée');
      setShowModal(false);
      setFormNumeroColis(''); setFormProduit(''); setFormDateRetour(''); setFormNotes('');
      await load();
    } catch {
      showError('Erreur', "Impossible d'ajouter l'expédition");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleSync() {
    if (!selected) return;
    setSyncing(true);
    try {
      const updated = await chronopostService.sync(selected.id);
      setSelected(updated);
      setExpeditions(prev => prev.map(e => e.id === updated.id ? updated : e));
      success('Synchronisé avec Chronopost');
    } catch {
      showError('Erreur', 'Synchronisation échouée');
    } finally {
      setSyncing(false);
    }
  }

  async function handleMarkReturned() {
    if (!selected) return;
    try {
      const updated = await chronopostService.markReturned(selected.id);
      setSelected(updated);
      setExpeditions(prev => prev.map(e => e.id === updated.id ? updated : e));
      success('Marqué comme rentré');
    } catch {
      showError('Erreur', 'Impossible de marquer comme rentré');
    }
  }

  async function handleStatutChange(statut: ChronopostStatut) {
    if (!selected) return;
    setSavingStatut(true);
    try {
      const updated = await chronopostService.update(selected.id, { statut });
      setSelected(updated);
      setExpeditions(prev => prev.map(e => e.id === updated.id ? updated : e));
    } catch {
      showError('Erreur', 'Impossible de modifier le statut');
    } finally {
      setSavingStatut(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!confirm(`Supprimer l'expédition ${selected.numeroColis} ?`)) return;
    try {
      await chronopostService.delete(selected.id);
      setSelected(null);
      setExpeditions(prev => prev.filter(e => e.id !== selected.id));
      success('Supprimée');
    } catch {
      showError('Erreur', 'Impossible de supprimer');
    }
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const monthLabel = currentDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const today = new Date();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 p-6">
      {/* Calendar */}
      <div className={clsx('flex flex-col transition-all duration-300', selected ? 'flex-1' : 'w-full max-w-3xl mx-auto')}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Chronopost</h1>
            <p className="text-sm text-gray-500 mt-0.5">{expeditions.length} expédition{expeditions.length !== 1 ? 's' : ''} suivie{expeditions.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            Nouvelle expédition
          </button>
        </div>

        {/* Month nav */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
          </button>
          <h2 className="text-base font-semibold text-gray-800 capitalize">{monthLabel}</h2>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronRightIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-2">{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-xl overflow-hidden flex-1">
          {days.map((day, i) => {
            if (!day) return <div key={i} className="bg-gray-50" />;
            const { departures, normalReturns, overdueReturns } = getEventsForDay(day);
            const hasEvents = departures.length + normalReturns.length + overdueReturns.length > 0;
            const isToday = isSameDay(new Date(year, month, day), today);
            const isSelected = selected && (
              (selected.dateDepart && isSameDay(new Date(selected.dateDepart), new Date(year, month, day))) ||
              ((selected.dateRetourReel || selected.dateRetourPrevu) && isSameDay(new Date(selected.dateRetourReel || selected.dateRetourPrevu!), new Date(year, month, day)))
            );

            return (
              <div
                key={i}
                onClick={() => handleDayClick(day)}
                className={clsx(
                  'bg-white min-h-[80px] p-2 flex flex-col transition-colors',
                  hasEvents ? 'cursor-pointer hover:bg-blue-50' : '',
                  isSelected ? 'bg-blue-50' : '',
                )}
              >
                <span className={clsx(
                  'text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1',
                  isToday ? 'bg-blue-600 text-white' : 'text-gray-700',
                )}>
                  {day}
                </span>
                <div className="flex flex-col gap-0.5 flex-1">
                  {departures.map(e => (
                    <div key={e.id} className="text-[10px] bg-blue-100 text-blue-700 rounded px-1 py-0.5 truncate font-medium leading-tight">
                      ✈ {e.clientNom}
                    </div>
                  ))}
                  {overdueReturns.map(e => (
                    <div key={e.id} className="text-[10px] bg-orange-100 text-orange-700 rounded px-1 py-0.5 truncate font-medium leading-tight">
                      ⚠ {e.clientNom}
                    </div>
                  ))}
                  {normalReturns.map(e => (
                    <div key={e.id} className="text-[10px] bg-green-100 text-green-700 rounded px-1 py-0.5 truncate font-medium leading-tight">
                      ↩ {e.clientNom}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-blue-100 rounded" /> Départ</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-green-100 rounded" /> Retour prévu</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-orange-100 rounded" /> Retour en retard</span>
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="w-96 flex-shrink-0 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden shadow-sm">
          {/* Panel header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div>
              <p className="text-xs text-gray-400 font-mono">{selected.numeroColis}</p>
              <h3 className="font-semibold text-gray-900 mt-0.5 truncate max-w-[220px]">{selected.clientNom}</h3>
            </div>
            <button onClick={() => setSelected(null)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <XMarkIcon className="h-5 w-5 text-gray-400" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 p-4 space-y-4">
            {/* Statut */}
            <div>
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Statut</label>
              <select
                value={selected.statut}
                onChange={e => handleStatutChange(e.target.value as ChronopostStatut)}
                disabled={savingStatut}
                className={clsx('mt-1 w-full text-sm px-3 py-1.5 rounded-lg border-0 font-medium cursor-pointer', STATUT_COLORS[selected.statut])}
              >
                {Object.entries(STATUT_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {/* Infos */}
            <div className="grid grid-cols-2 gap-3">
              {selected.produitNom && (
                <div>
                  <p className="text-xs text-gray-400">Borne</p>
                  <p className="text-sm font-medium text-gray-800">{selected.produitNom}</p>
                </div>
              )}
              {selected.clientVille && (
                <div>
                  <p className="text-xs text-gray-400">Ville</p>
                  <p className="text-sm font-medium text-gray-800">{selected.clientVille}</p>
                </div>
              )}
              {selected.clientAdresse && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400">Adresse</p>
                  <p className="text-sm text-gray-700">{selected.clientAdresse}</p>
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Dates</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-blue-50 rounded-lg p-2">
                  <p className="text-xs text-blue-500">Départ</p>
                  <p className="font-medium text-blue-800">{formatDate(selected.dateDepart)}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-2">
                  <p className="text-xs text-green-500">Livraison</p>
                  <p className="font-medium text-green-800">{formatDate(selected.dateLivraisonReelle)}</p>
                </div>
                <div className={clsx('rounded-lg p-2', selected.statut === 'rentre' ? 'bg-emerald-50' : 'bg-orange-50')}>
                  <p className={clsx('text-xs', selected.statut === 'rentre' ? 'text-emerald-500' : 'text-orange-500')}>Retour prévu</p>
                  <p className={clsx('font-medium', selected.statut === 'rentre' ? 'text-emerald-800' : 'text-orange-800')}>{formatDate(selected.dateRetourPrevu)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-400">Retour réel</p>
                  <p className="font-medium text-gray-700">{formatDate(selected.dateRetourReel)}</p>
                </div>
              </div>
            </div>

            {/* Tracking link */}
            <a
              href={`https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${selected.numeroColis}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              Voir sur Chronopost.fr
            </a>

            {/* Tracking events */}
            {selected.trackingData?.events && selected.trackingData.events.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Historique de suivi</p>
                <div className="space-y-2">
                  {[...selected.trackingData.events].reverse().map((event, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="w-2 h-2 rounded-full bg-gray-300 mt-1" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">{event.libelle}</p>
                        <p className="text-gray-400">{formatDateTime(event.date)} {event.site ? `· ${event.site}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {selected.notes && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2">{selected.notes}</p>
              </div>
            )}
          </div>

          {/* Panel footer actions */}
          <div className="p-4 border-t border-gray-100 space-y-2">
            {selected.statut !== 'rentre' && (
              <button
                onClick={handleMarkReturned}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                <CheckCircleIcon className="h-4 w-4" />
                Marquer comme rentré
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ArrowPathIcon className={clsx('h-4 w-4', syncing && 'animate-spin')} />
                {syncing ? 'Sync...' : 'Synchroniser'}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Nouvelle expédition Chronopost</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <XMarkIcon className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Numéro de colis <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formNumeroColis}
                  onChange={e => setFormNumeroColis(e.target.value)}
                  placeholder="ex: XY123456789FR"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">Le nom du client sera récupéré automatiquement depuis Chronopost</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de borne</label>
                <select
                  value={formProduit}
                  onChange={e => setFormProduit(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Sélectionner —</option>
                  {PRODUITS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date de retour prévue</label>
                <input
                  type="date"
                  value={formDateRetour}
                  onChange={e => setFormDateRetour(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={formLoading || !formNumeroColis.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {formLoading ? 'Chargement...' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ArrowTopRightOnSquareIcon,
  PlusIcon,
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

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toInputDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

export default function ChronopostPage() {
  const [expeditions, setExpeditions] = useState<ChronopostExpedition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingOne, setSyncingOne] = useState(false);
  const [savingStatut, setSavingStatut] = useState(false);
  const [selected, setSelected] = useState<ChronopostExpedition | null>(null);
  const [dayExpeditions, setDayExpeditions] = useState<ChronopostExpedition[] | null>(null);
  const [dayLabel, setDayLabel] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addNumeroColis, setAddNumeroColis] = useState('');
  const [addClientNom, setAddClientNom] = useState('');
  const [adding, setAdding] = useState(false);
  const { success, error: showError } = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Edit state in detail panel
  const [editProduit, setEditProduit] = useState('');
  const [editDateRetour, setEditDateRetour] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await chronopostService.list();
      setExpeditions(data);
      setLastSync(new Date());
      if (selected) {
        const refreshed = data.find(e => e.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch {
      if (!silent) showError('Erreur', 'Impossible de charger les expéditions');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  // Load on mount + auto-refresh every 5 min
  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(true), 5 * 60 * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Sync edit fields when selection changes
  useEffect(() => {
    if (selected) {
      setEditProduit(selected.produitNom ?? '');
      setEditDateRetour(selected.dateRetourPrevu ? toInputDate(new Date(selected.dateRetourPrevu)) : '');
      setEditNotes(selected.notes ?? '');
    }
  }, [selected?.id]);

  // Calendar
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const today = new Date();

  function getEventsForDay(day: number) {
    const date = new Date(year, month, day);
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

    const departures = expeditions.filter(e => e.dateDepart && isSameDay(new Date(e.dateDepart), date));
    const returns = expeditions.filter(e => {
      const d = e.dateRetourReel || e.dateRetourPrevu;
      return d && isSameDay(new Date(d), date);
    });
    const overdueReturns = returns.filter(e => {
      if (e.statut === 'rentre') return false;
      if (!e.dateRetourPrevu) return false;
      const d = new Date(e.dateRetourPrevu); d.setHours(0, 0, 0, 0);
      return d < todayMidnight;
    });
    const normalReturns = returns.filter(e => !overdueReturns.includes(e));
    return { departures, normalReturns, overdueReturns };
  }

  function handleDayClick(day: number) {
    const { departures, normalReturns, overdueReturns } = getEventsForDay(day);
    const all = [...departures, ...overdueReturns, ...normalReturns];
    if (all.length === 0) return;
    const date = new Date(year, month, day);
    const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (all.length === 1) {
      setSelected(all[0]!);
      setDayExpeditions(null);
    } else {
      setDayExpeditions(all);
      setDayLabel(label);
      setSelected(null);
    }
  }

  async function handleAdd() {
    if (!addNumeroColis.trim()) return;
    setAdding(true);
    try {
      const expedition = await chronopostService.add(addNumeroColis.trim(), addClientNom.trim() || undefined);
      setExpeditions(prev => [expedition, ...prev]);
      setSelected(expedition);
      setShowAddModal(false);
      setAddNumeroColis('');
      setAddClientNom('');
      success('Colis ajouté');
    } catch (e: any) {
      showError('Erreur', e?.response?.data?.error?.message || 'Impossible d\'ajouter ce colis');
    } finally {
      setAdding(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSyncOne() {
    if (!selected) return;
    setSyncingOne(true);
    try {
      const updated = await chronopostService.syncOne(selected.id);
      setSelected(updated);
      setExpeditions(prev => prev.map(e => e.id === updated.id ? updated : e));
      success('Détails de suivi mis à jour');
    } catch {
      showError('Erreur', 'Synchronisation échouée');
    } finally {
      setSyncingOne(false);
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

  async function handleSaveEdit() {
    if (!selected) return;
    setSavingEdit(true);
    try {
      const updated = await chronopostService.update(selected.id, {
        produitNom: editProduit || undefined,
        dateRetourPrevu: editDateRetour || undefined,
        notes: editNotes || undefined,
      });
      setSelected(updated);
      setExpeditions(prev => prev.map(e => e.id === updated.id ? updated : e));
      success('Sauvegardé');
    } catch {
      showError('Erreur', 'Impossible de sauvegarder');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!confirm(`Supprimer ${selected.numeroColis} ?`)) return;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4 p-6 overflow-hidden">
      {/* Calendar */}
      <div className={clsx('flex flex-col min-w-0 transition-all duration-300', selected ? 'flex-1' : 'w-full max-w-4xl mx-auto')}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Chronopost</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {expeditions.length > 0
                ? `${expeditions.length} expédition${expeditions.length > 1 ? 's' : ''} · Compte 15450704`
                : 'Aucun colis importé'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastSync && (
              <span className="text-xs text-gray-400">
                Sync {lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
              title="Actualiser"
            >
              <ArrowPathIcon className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <PlusIcon className="h-4 w-4" />
              Ajouter un colis
            </button>
          </div>
        </div>

        {/* Empty state */}
        {expeditions.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
            <div className="h-16 w-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
              <PlusIcon className="h-8 w-8 text-blue-400" />
            </div>
            <p className="text-gray-700 text-lg font-semibold mb-1">Aucun colis enregistré</p>
            <p className="text-gray-400 text-sm mb-6 max-w-xs">
              Ajoutez vos numéros de colis Chronopost — le statut se mettra à jour automatiquement toutes les 15 min.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <PlusIcon className="h-4 w-4" />
              Ajouter un colis
            </button>
          </div>
        )}

        {expeditions.length > 0 && (
          <>
            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
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
                <div key={d} className="text-center text-xs font-medium text-gray-400 py-1.5">{d}</div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-xl overflow-hidden flex-1">
              {days.map((day, i) => {
                if (!day) return <div key={i} className="bg-gray-50" />;
                const { departures, normalReturns, overdueReturns } = getEventsForDay(day);
                const hasEvents = departures.length + normalReturns.length + overdueReturns.length > 0;
                const isToday = isSameDay(new Date(year, month, day), today);
                const cellDate = new Date(year, month, day);
                const isSelected = (
                  (selected && selected.dateDepart && isSameDay(new Date(selected.dateDepart), cellDate)) ||
                  (selected && (selected.dateRetourReel ?? selected.dateRetourPrevu) &&
                    isSameDay(new Date((selected.dateRetourReel ?? selected.dateRetourPrevu)!), cellDate)) ||
                  (dayExpeditions && dayExpeditions.length > 0 && (
                    dayExpeditions.some(e => e.dateDepart && isSameDay(new Date(e.dateDepart), cellDate)) ||
                    dayExpeditions.some(e => (e.dateRetourReel ?? e.dateRetourPrevu) &&
                      isSameDay(new Date((e.dateRetourReel ?? e.dateRetourPrevu)!), cellDate))
                  ))
                );

                return (
                  <div
                    key={i}
                    onClick={() => handleDayClick(day)}
                    className={clsx(
                      'bg-white min-h-[72px] p-1.5 flex flex-col transition-colors',
                      hasEvents ? 'cursor-pointer hover:bg-blue-50' : 'cursor-default',
                      isSelected ? '!bg-blue-50' : '',
                    )}
                  >
                    <span className={clsx(
                      'text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full mb-1 self-end',
                      isToday ? 'bg-blue-600 text-white' : 'text-gray-500',
                    )}>
                      {day}
                    </span>
                    <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
                      {departures.slice(0, 3).map(e => (
                        <div key={e.id} className="text-[9px] bg-blue-100 text-blue-700 rounded px-1 py-0.5 truncate font-medium leading-tight">
                          ✈ {e.clientNom}
                        </div>
                      ))}
                      {overdueReturns.slice(0, 1).map(e => (
                        <div key={e.id} className="text-[9px] bg-orange-100 text-orange-700 rounded px-1 py-0.5 truncate font-medium leading-tight">
                          ⚠ {e.clientNom}
                        </div>
                      ))}
                      {normalReturns.slice(0, 1).map(e => (
                        <div key={e.id} className="text-[9px] bg-green-100 text-green-700 rounded px-1 py-0.5 truncate font-medium leading-tight">
                          ↩ {e.clientNom}
                        </div>
                      ))}
                      {(() => {
                        const total = departures.length + normalReturns.length + overdueReturns.length;
                        const shown = Math.min(departures.length, 3) + Math.min(overdueReturns.length, 1) + Math.min(normalReturns.length, 1);
                        return total > shown ? (
                          <div className="text-[9px] font-semibold text-blue-500 px-1">+{total - shown} autres</div>
                        ) : null;
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-blue-100 rounded" /> Départ</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-green-100 rounded" /> Retour prévu</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-orange-100 rounded" /> En retard</span>
            </div>
          </>
        )}
      </div>

      {/* Day list panel — shown when multiple events on a day */}
      {dayExpeditions && !selected && (
        <div className="flex-shrink-0 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden shadow-sm" style={{ width: '360px' }}>
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div className="min-w-0">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Journée du</p>
              <h3 className="font-semibold text-gray-900 capitalize">{dayLabel}</h3>
            </div>
            <button onClick={() => setDayExpeditions(null)} className="ml-2 p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0">
              <XMarkIcon className="h-5 w-5 text-gray-400" />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
            {dayExpeditions.map(e => (
              <button
                key={e.id}
                onClick={() => setSelected(e)}
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', STATUT_COLORS[e.statut])}>
                      {STATUT_LABELS[e.statut]}
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 text-sm truncate">{e.clientNom}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{e.numeroColis}</p>
                  {e.clientVille && <p className="text-xs text-gray-400 mt-0.5">{e.clientVille}</p>}
                </div>
                <ChevronRightIcon className="h-4 w-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
          <div className="p-3 border-t border-gray-100 text-center text-xs text-gray-400">
            {dayExpeditions.length} colis ce jour
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <div className="w-88 flex-shrink-0 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden shadow-sm" style={{ width: '360px' }}>
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div className="flex items-center gap-2 min-w-0">
              {dayExpeditions && (
                <button
                  onClick={() => setSelected(null)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0 text-gray-400"
                  title="Retour à la liste du jour"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-xs text-gray-400 font-mono truncate">{selected.numeroColis}</p>
                <h3 className="font-semibold text-gray-900 mt-0.5 truncate">{selected.clientNom}</h3>
              </div>
            </div>
            <button onClick={() => { setSelected(null); setDayExpeditions(null); }} className="ml-2 p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0">
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
                className={clsx('mt-1 w-full text-sm px-3 py-1.5 rounded-lg border border-transparent font-medium cursor-pointer', STATUT_COLORS[selected.statut])}
              >
                {(Object.entries(STATUT_LABELS) as [ChronopostStatut, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {/* Significant event from Chronopost */}
            {selected.trackingData?.significantEvent && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p className="text-xs text-gray-400 mb-1">Dernier événement Chronopost</p>
                <p className="font-medium text-gray-800">{selected.trackingData.significantEvent.eventLabel}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatDateTime(selected.trackingData.significantEvent.eventDate)}
                  {selected.trackingData.significantEvent.officeLabel && ` · ${selected.trackingData.significantEvent.officeLabel}`}
                </p>
              </div>
            )}

            {/* Dates */}
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Dates</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-50 rounded-lg p-2.5">
                  <p className="text-xs text-blue-500">Dépôt Chronopost</p>
                  <p className="font-semibold text-blue-800 text-sm">{formatDate(selected.dateDepart)}</p>
                </div>
                <div className={clsx('rounded-lg p-2.5', selected.statut === 'rentre' ? 'bg-emerald-50' : 'bg-orange-50')}>
                  <p className={clsx('text-xs', selected.statut === 'rentre' ? 'text-emerald-500' : 'text-orange-500')}>Retour prévu</p>
                  <p className={clsx('font-semibold text-sm', selected.statut === 'rentre' ? 'text-emerald-800' : 'text-orange-800')}>
                    {formatDate(selected.dateRetourPrevu)}
                  </p>
                </div>
              </div>
              {selected.dateRetourReel && (
                <div className="bg-emerald-50 rounded-lg p-2.5 mt-2">
                  <p className="text-xs text-emerald-500">Retour réel</p>
                  <p className="font-semibold text-emerald-800 text-sm">{formatDate(selected.dateRetourReel)}</p>
                </div>
              )}
            </div>

            {/* Full tracking history (when synced individually) */}
            {selected.trackingData?.events && selected.trackingData.events.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Historique complet</p>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {[...selected.trackingData.events].reverse().map((ev, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-gray-700">{ev.libelle}</p>
                        <p className="text-gray-400">{formatDateTime(ev.date)}{ev.site ? ` · ${ev.site}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Editable fields */}
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Informations logistiques</p>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Type de borne</label>
                <select
                  value={editProduit}
                  onChange={e => setEditProduit(e.target.value)}
                  className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">— Non défini —</option>
                  {PRODUITS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Date de retour prévue</label>
                <input
                  type="date"
                  value={editDateRetour}
                  onChange={e => setEditDateRetour(e.target.value)}
                  className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="w-full px-3 py-1.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
              >
                {savingEdit ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </div>

            {/* Chronopost link */}
            <a
              href={`https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${selected.numeroColis}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              Voir sur Chronopost.fr
            </a>
          </div>

          {/* Actions footer */}
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
                onClick={handleSyncOne}
                disabled={syncingOne}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ArrowPathIcon className={clsx('h-3.5 w-3.5', syncingOne && 'animate-spin')} />
                {syncingOne ? 'Sync...' : 'Historique complet'}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add parcel modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Ajouter un colis</h2>
                <p className="text-sm text-gray-400 mt-0.5">Le suivi se met à jour automatiquement</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <XMarkIcon className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Numéro de colis <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addNumeroColis}
                  onChange={e => setAddNumeroColis(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  placeholder="ex: EX123456789FR"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom du client <span className="text-gray-400 font-normal">(optionnel)</span>
                </label>
                <input
                  type="text"
                  value={addClientNom}
                  onChange={e => setAddClientNom(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  placeholder="ex: Mariage Dupont"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Si vide, récupéré automatiquement depuis Chronopost</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || !addNumeroColis.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? (
                  <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Recherche...</>
                ) : (
                  <><PlusIcon className="h-4 w-4" /> Ajouter</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

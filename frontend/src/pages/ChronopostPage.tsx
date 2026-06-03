import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  ArrowPathIcon,
  PlusIcon,
  KeyIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { chronopostService, ChronopostExpedition } from '@/services/chronopost.service';
import { useToast } from '@/hooks/useToast';
import clsx from 'clsx';

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

// Dimanche de Pâques (algorithme de Meeus/Butcher) pour une année donnée.
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Jours fériés français (métropole) pour une année — mémoïsé.
const holidaysCache = new Map<number, Set<string>>();
function frenchHolidays(year: number): Set<string> {
  const cached = holidaysCache.get(year);
  if (cached) return cached;
  const set = new Set<string>();
  // Fériés fixes
  for (const [m, d] of [[1, 1], [5, 1], [5, 8], [7, 14], [8, 15], [11, 1], [11, 11], [12, 25]]) {
    set.add(dateKey(new Date(year, m - 1, d)));
  }
  // Fériés mobiles (basés sur Pâques)
  const easter = easterSunday(year);
  const addDays = (base: Date, n: number) => { const x = new Date(base); x.setDate(x.getDate() + n); return x; };
  set.add(dateKey(addDays(easter, 1)));  // Lundi de Pâques
  set.add(dateKey(addDays(easter, 39))); // Ascension
  set.add(dateKey(addDays(easter, 50))); // Lundi de Pentecôte
  holidaysCache.set(year, set);
  return set;
}

function isBusinessDay(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false; // week-end
  return !frenchHolidays(d.getFullYear()).has(dateKey(d)); // jour férié
}

// Jours ouvrés = lundi→vendredi hors jours fériés français. n>0 ajoute, n<0 retire.
function addBusinessDays(date: Date, n: number): Date {
  const d = new Date(date);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}

export default function ChronopostPage() {
  const [expeditions, setExpeditions] = useState<ChronopostExpedition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ChronopostExpedition | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addNumeroColis, setAddNumeroColis] = useState('');
  const [addClientNom, setAddClientNom] = useState('');
  const [adding, setAdding] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionConfigured, setSessionConfigured] = useState<boolean | null>(null);
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<string | null>(null);
  const [newCookies, setNewCookies] = useState('');
  const [savingSession, setSavingSession] = useState(false);
  const { success, error: showError } = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const status = await chronopostService.getSessionStatus();
      setSessionConfigured(status.configured);
      setSessionUpdatedAt(status.updatedAt);
    } catch {
      // non-critical
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await chronopostService.list();
      setExpeditions(data);
      setLastSync(new Date());
      setSelected(prev => {
        if (!prev) return prev;
        return data.find(e => e.id === prev.id) ?? prev;
      });
    } catch {
      if (!silent) showError('Erreur', 'Impossible de charger les expéditions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount + auto-refresh every 5 min
  useEffect(() => {
    load();
    loadSession();
    intervalRef.current = setInterval(() => load(true), 5 * 60 * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

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

  // Normalise a date to noon UTC to avoid DST edge-cases when comparing days
  function noon(d: Date): Date {
    const c = new Date(d); c.setHours(12, 0, 0, 0); return c;
  }

  // Durée d'immobilisation de la borne (départ de nos locaux → retour dans nos locaux).
  // Règle : départ = 3 jours ouvrés AVANT la presta, retour = 2 jours ouvrés APRÈS.
  // Calculé depuis la date d'événement quand on l'a (import CRM) ; sinon repli sur
  // les dates transporteur réelles (colis manuel/Chronotrace).
  function immobSpan(e: ChronopostExpedition): { start: Date; end: Date } | null {
    if (e.dateEvenement) {
      const ev = noon(new Date(e.dateEvenement));
      return { start: noon(addBusinessDays(ev, -3)), end: noon(addBusinessDays(ev, 2)) };
    }
    if (!e.dateDepart) return null;
    const dep = noon(new Date(e.dateDepart));
    const returnRaw = e.dateRetourReel || e.dateRetourPrevu;
    return { start: dep, end: returnRaw ? noon(new Date(returnRaw)) : dep };
  }

  interface WeekBar {
    e: ChronopostExpedition;
    startCol: number;   // colonne de début dans la semaine (0-6)
    endCol: number;     // colonne de fin dans la semaine (0-6)
    isStart: boolean;   // vrai si c'est le vrai départ (pas une continuation de la semaine précédente)
    isEnd: boolean;     // vrai si c'est le vrai retour
    isOverdue: boolean;
    lane: number;       // ligne d'empilement dans la semaine
  }

  // Calcule, pour une semaine (7 cases), les barres continues à afficher :
  // un événement = une seule barre qui s'étend de sa colonne de départ à sa
  // colonne de fin (durée d'immobilisation), empilées sur des lignes (lanes).
  function computeWeekBars(week: (number | null)[]): { bars: WeekBar[]; lanes: number } {
    const colDates = week.map(d => (d ? noon(new Date(year, month, d)) : null));
    const todayNoon = noon(new Date());
    const bars: WeekBar[] = [];

    for (const e of expeditions) {
      const span = immobSpan(e);
      if (!span) continue;
      let startCol = -1;
      let endCol = -1;
      for (let c = 0; c < 7; c++) {
        const cd = colDates[c];
        if (!cd) continue;
        if (cd >= span.start && cd <= span.end) {
          if (startCol === -1) startCol = c;
          endCol = c;
        }
      }
      if (startCol === -1) continue; // l'événement ne touche pas cette semaine
      bars.push({
        e,
        startCol,
        endCol,
        isStart: isSameDay(colDates[startCol]!, span.start),
        isEnd: isSameDay(colDates[endCol]!, span.end),
        isOverdue: e.statut !== 'rentre' && span.end < todayNoon,
        lane: 0,
      });
    }

    // Empilement glouton : une barre ne partage pas une ligne avec une autre qui chevauche ses colonnes
    bars.sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);
    const laneEnd: number[] = [];
    for (const bar of bars) {
      let lane = 0;
      while (laneEnd[lane] !== undefined && laneEnd[lane]! >= bar.startCol) lane++;
      laneEnd[lane] = bar.endCol;
      bar.lane = lane;
    }
    return { bars, lanes: laneEnd.length };
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

  async function handleSyncAll() {
    setRefreshing(true);
    try {
      const data = await chronopostService.syncAll();
      setExpeditions(data);
      setLastSync(new Date());
      setSelected(prev => {
        if (!prev) return prev;
        return data.find(e => e.id === prev.id) ?? null;
      });
      success('Synchronisation complète effectuée');
    } catch {
      showError('Erreur', 'Synchronisation échouée');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveSession() {
    if (!newCookies.trim()) return;
    setSavingSession(true);
    try {
      await chronopostService.updateSession(newCookies.trim());
      setSessionConfigured(true);
      setSessionUpdatedAt(new Date().toISOString());
      setShowSessionModal(false);
      setNewCookies('');
      success('Session Chronotrace mise à jour — la sync démarrera dans 15 min');
    } catch {
      showError('Erreur', 'Impossible de sauvegarder la session');
    } finally {
      setSavingSession(false);
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
              title="Recharger la liste"
            >
              <ArrowPathIcon className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
            <button
              onClick={handleSyncAll}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              title="Synchroniser tous les colis via Chronotrace"
            >
              <ArrowPathIcon className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
              Sync
            </button>
            <button
              onClick={() => setShowSessionModal(true)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                sessionConfigured === false
                  ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50',
              )}
              title="Configuration sync automatique"
            >
              {sessionConfigured === false
                ? <ExclamationTriangleIcon className="h-4 w-4" />
                : <KeyIcon className="h-4 w-4" />}
              Session
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

            {/* Days grid — une barre continue par événement sur sa durée d'immobilisation */}
            <div className="flex flex-col gap-px bg-gray-200 rounded-xl overflow-hidden flex-1">
              {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => days.slice(wi * 7, wi * 7 + 7)).map((week, wi) => {
                const { bars, lanes } = computeWeekBars(week);
                return (
                  <div key={wi} className="bg-white flex flex-col">
                    {/* Numéros de jour */}
                    <div className="grid grid-cols-7">
                      {week.map((day, di) => {
                        if (!day) return <div key={di} className="min-h-[24px]" />;
                        const dObj = new Date(year, month, day);
                        const isToday = isSameDay(dObj, today);
                        const isHoliday = frenchHolidays(year).has(dateKey(dObj));
                        return (
                          <div key={di} className="relative flex items-center justify-center pt-1 min-h-[24px]">
                            {isHoliday && (
                              <span className="absolute left-1 top-1 text-[8px] font-semibold text-red-500 uppercase leading-none" title="Jour férié">férié</span>
                            )}
                            <span className={clsx(
                              'text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0',
                              isToday ? 'bg-blue-600 text-white' : isHoliday ? 'text-red-500' : 'text-gray-500',
                            )}>
                              {day}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Barres d'immobilisation (grid-column span) */}
                    <div
                      className="grid grid-cols-7 gap-y-0.5 px-0.5 pb-1.5 pt-0.5"
                      style={{ gridAutoRows: '17px', minHeight: `${Math.max(lanes, 1) * 19 + 4}px` }}
                    >
                      {bars.map((bar, bi) => {
                        const isActive = selected?.id === bar.e.id;
                        const bg = bar.isOverdue
                          ? (isActive ? 'bg-orange-300 text-orange-900' : 'bg-orange-100 text-orange-700')
                          : bar.e.statut === 'rentre'
                            ? (isActive ? 'bg-emerald-300 text-emerald-900' : 'bg-emerald-100 text-emerald-700')
                            : (isActive ? 'bg-blue-300 text-blue-900' : 'bg-blue-100 text-blue-700');
                        return (
                          <button
                            key={bar.e.id + '_' + bi}
                            onClick={() => setSelected(bar.e)}
                            title={bar.e.clientNom}
                            style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.lane + 1 }}
                            className={clsx(
                              'text-[10px] px-1 py-0.5 truncate font-medium leading-tight text-left transition-opacity hover:opacity-80',
                              bg,
                              bar.isStart ? 'rounded-l-md ml-0.5' : '',
                              bar.isEnd ? 'rounded-r-md mr-0.5' : '',
                            )}
                          >
                            {bar.isStart ? (bar.isOverdue ? '⚠ ' : '🚚 ') : ''}{bar.e.clientNom}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-blue-100 rounded" /> 🚚 Immobilisation (départ → retour)</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-emerald-100 rounded" /> Rentré</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-orange-100 rounded" /> ⚠ En retard</span>
            </div>
          </>
        )}
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="w-88 flex-shrink-0 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden shadow-sm" style={{ width: '360px' }}>
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <div className="min-w-0">
              <p className={clsx('text-xs font-mono truncate', selected.numeroColis ? 'text-gray-400' : 'text-orange-500 italic')}>
                {selected.numeroColis || 'N° à venir'}
              </p>
              <h3 className="font-semibold text-gray-900 mt-0.5 truncate">{selected.clientNom}</h3>
            </div>
            <button onClick={() => setSelected(null)} className="ml-2 p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0">
              <XMarkIcon className="h-5 w-5 text-gray-400" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 p-4 space-y-4">
            {/* Dates — immobilisation borne (départ de nos locaux → retour) */}
            {(() => {
              const span = immobSpan(selected);
              return (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Immobilisation</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-50 rounded-lg p-2.5">
                  <p className="text-xs text-blue-500">Départ de nos locaux</p>
                  <p className="font-semibold text-blue-800 text-sm">{span ? formatDate(span.start.toISOString()) : '—'}</p>
                  {selected.dateEvenement && <p className="text-[10px] text-blue-400 mt-0.5">3 j. ouvrés avant</p>}
                </div>
                <div className={clsx('rounded-lg p-2.5', selected.statut === 'rentre' ? 'bg-emerald-50' : 'bg-orange-50')}>
                  <p className={clsx('text-xs', selected.statut === 'rentre' ? 'text-emerald-500' : 'text-orange-500')}>Retour dans nos locaux</p>
                  <p className={clsx('font-semibold text-sm', selected.statut === 'rentre' ? 'text-emerald-800' : 'text-orange-800')}>
                    {span ? formatDate(span.end.toISOString()) : '—'}
                  </p>
                  {selected.dateEvenement && <p className={clsx('text-[10px] mt-0.5', selected.statut === 'rentre' ? 'text-emerald-400' : 'text-orange-400')}>2 j. ouvrés après</p>}
                </div>
              </div>
              {selected.dateRetourReel && (
                <div className="bg-emerald-50 rounded-lg p-2.5 mt-2">
                  <p className="text-xs text-emerald-500">Retour réel</p>
                  <p className="font-semibold text-emerald-800 text-sm">{formatDate(selected.dateRetourReel)}</p>
                </div>
              )}
              {selected.numeroColisRetour && (
                <div className="bg-gray-50 rounded-lg p-2.5 mt-2">
                  <p className="text-xs text-gray-400">N° colis retour</p>
                  <p className="font-mono text-xs text-gray-700 mt-0.5">{selected.numeroColisRetour}</p>
                </div>
              )}
            </div>
              );
            })()}

            {/* Infos événement (import CRM) */}
            {(selected.dateEvenement || selected.clientAdresse || selected.contactNom || selected.contactTelephone || selected.modeRetour) && (
              <div className="space-y-1.5 text-sm border-t border-gray-100 pt-4">
                {selected.dateEvenement && (
                  <div className="flex justify-between"><span className="text-gray-400">Événement</span><span className="font-medium text-gray-800">{formatDate(selected.dateEvenement)}</span></div>
                )}
                {selected.clientAdresse && (
                  <div className="flex justify-between gap-3"><span className="text-gray-400 flex-shrink-0">Adresse</span><span className="text-gray-700 text-right">{selected.clientAdresse}{selected.clientVille ? `, ${selected.clientVille}` : ''}</span></div>
                )}
                {selected.contactNom && (
                  <div className="flex justify-between gap-3"><span className="text-gray-400">Contact</span><span className="text-gray-700 text-right">{selected.contactNom}</span></div>
                )}
                {selected.contactTelephone && (
                  <div className="flex justify-between"><span className="text-gray-400">Téléphone</span><span className="text-gray-700">{selected.contactTelephone}</span></div>
                )}
                {selected.modeRetour && (
                  <div className="flex justify-between"><span className="text-gray-400">Retour</span><span className="text-gray-700">{selected.modeRetour === 'recup' ? 'Récupération chauffeur' : selected.modeRetour === 'poste' ? 'Renvoi par le client' : selected.modeRetour}</span></div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* Session modal */}
      {showSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) setShowSessionModal(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Sync automatique Chronotrace</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {sessionConfigured
                    ? `Session active · mise à jour ${sessionUpdatedAt ? new Date(sessionUpdatedAt).toLocaleDateString('fr-FR') : '—'}`
                    : 'Aucune session configurée — les nouveaux colis ne se détectent pas'}
                </p>
              </div>
              <button onClick={() => setShowSessionModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <XMarkIcon className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="bg-blue-50 rounded-lg p-3 mb-4 text-sm text-blue-800">
              <p className="font-medium mb-1">Comment récupérer les cookies ?</p>
              <ol className="list-decimal list-inside space-y-1 text-xs text-blue-700">
                <li>Allez sur <strong>chronotrace.chronopost.fr</strong> et connectez-vous</li>
                <li>Ouvrez DevTools → Réseau (F12)</li>
                <li>Rechargez la page ou faites une action</li>
                <li>Cliquez sur une requête vers <strong>predefinedSearch</strong></li>
                <li>Dans En-têtes → Copiez la valeur du header <strong>Cookie</strong></li>
                <li>Collez-la ci-dessous</li>
              </ol>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Valeur du header Cookie
              </label>
              <textarea
                value={newCookies}
                onChange={e => setNewCookies(e.target.value)}
                rows={4}
                placeholder="cv4Auth=...; CHRONOTRACESESSIONID=...; cf_clearance=..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                Ces cookies expirent après quelques semaines — revenez ici pour les renouveler si la sync ne fonctionne plus.
              </p>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowSessionModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveSession}
                disabled={savingSession || !newCookies.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingSession ? <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Sauvegarde...</> : 'Enregistrer la session'}
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

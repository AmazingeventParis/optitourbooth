import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { agendaService, AllocationBlock, StockData, AgendaMachine } from '@/services/agenda.service';
import { pendingPointsService } from '@/services/pendingPoints.service';
import { Modal } from '@/components/ui';
import { ChevronLeftIcon, ChevronRightIcon, MapPinIcon, PhoneIcon, UserIcon, TruckIcon, CalendarDaysIcon, ClockIcon, WrenchScrewdriverIcon, FunnelIcon, BoltIcon, ExclamationTriangleIcon, ArrowPathIcon, CheckCircleIcon, LockOpenIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';

const MACHINE_TYPE_ORDER = ['Vegas', 'Smakk', 'Ring', 'Miroir', 'Playbox', 'Aircam', 'Spinner'];

const TYPE_COLORS: Record<string, string> = {
  Vegas: '#616161', Smakk: '#F6BF26', Ring: '#8E24AA', Miroir: '#F4511E',
  Playbox: '#E67C73', Aircam: '#3F51B5', Spinner: '#0B8043',
};

type ViewMode = 'day' | 'week' | 'month';

function lighten(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.round(((num >> 16) & 0xFF) + (255 - ((num >> 16) & 0xFF)) * amount));
  const g = Math.min(255, Math.round(((num >> 8) & 0xFF) + (255 - ((num >> 8) & 0xFF)) * amount));
  const b = Math.min(255, Math.round((num & 0xFF) + (255 - (num & 0xFF)) * amount));
  return `rgb(${r},${g},${b})`;
}

/** Compute bar position as % of 6h-24h range (18h span) */
function timeToPercent(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const minutes = (h! * 60 + (m || 0)) - 360; // offset from 6h
  return Math.max(0, Math.min(100, (minutes / (18 * 60)) * 100));
}

export default function AgendaPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [allocations, setAllocations] = useState<AllocationBlock[]>([]);
  const [stock, setStock] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<Record<string, AgendaMachine[]>>({});
  const [selectedStockDate, setSelectedStockDate] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<AllocationBlock | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dragBlock, setDragBlock] = useState<AllocationBlock | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [marginWarning, setMarginWarning] = useState<{ block: AllocationBlock; targetKey: string; warnings: string[] } | null>(null);
  const navigate = useNavigate();

  // Find machine object from row key
  const findMachineByKey = (targetRowKey: string): AgendaMachine | null => {
    for (const [, typeMachines] of Object.entries(machines)) {
      const found = typeMachines.find(m => `${m.type}-${m.numero}` === targetRowKey);
      if (found) return found;
    }
    return null;
  };

  // Handle drop: check margin then assign
  const handleDrop = async (block: AllocationBlock, targetRowKey: string) => {
    const targetMachine = findMachineByKey(targetRowKey);
    if (!targetMachine) { toast.error('Machine non trouvée'); return; }
    if (targetMachine.type !== block.produit && block.produit !== '?') {
      toast.error(`Impossible : ${block.client} est un ${block.produit}, pas un ${targetMachine.type}`);
      return;
    }

    // Check 4h margin and overlaps
    try {
      const check = await agendaService.checkMargin({
        targetMachineId: targetMachine.id,
        dateStart: block.dateStart,
        timeStart: block.timeStart,
        dateEnd: block.dateEnd,
        timeEnd: block.timeEnd,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        blockClient: block.client,
      });

      if (!check.ok) {
        setMarginWarning({ block, targetKey: targetRowKey, warnings: check.warnings });
        return;
      }
    } catch { /* proceed if check fails */ }

    await doAssign(block, targetMachine);
  };

  // Actually perform the assignment
  const doAssign = async (block: AllocationBlock, targetMachine: AgendaMachine) => {
    try {
      await agendaService.assignMachine({
        blockId: block.id,
        targetMachineId: targetMachine.id,
        client: block.client,
        dateEvenement: block.dateStart,
      });
      toast.success(`${block.client} → ${targetMachine.type} ${targetMachine.numero}`);
      loadData();
    } catch {
      toast.error('Erreur lors de l\'assignation');
    }
  };

  // Handle optimize button
  const handleOptimize = async () => {
    if (!confirm('Optimiser automatiquement le placement des bornes pour cette semaine ?')) return;
    setOptimizing(true);
    try {
      const result = await agendaService.optimize(dateRange.from, dateRange.to);
      toast.success(result.message);
      loadData();
    } catch {
      toast.error('Erreur lors de l\'optimisation');
    } finally {
      setOptimizing(false);
    }
  };

  // Sync Google Calendar
  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await pendingPointsService.syncGoogleCalendar();
      toast.success(`Sync : ${result.created} créé(s), ${result.updated} mis à jour`);
      loadData();
    } catch {
      toast.error('Erreur sync Google Calendar');
    } finally {
      setSyncing(false);
    }
  };

  // Validate / unlock machine
  const handleValidateMachine = async (machineId: string, blocks: AllocationBlock[]) => {
    try {
      const result = await agendaService.validateMachine(
        machineId,
        blocks.map(b => ({ client: b.client, dateStart: b.dateStart }))
      );
      toast.success(result.message);
      loadData();
    } catch { toast.error('Erreur validation'); }
  };

  const handleUnlockMachine = async (machineId: string) => {
    try {
      const result = await agendaService.unlockMachine(machineId);
      toast.success(result.message);
      loadData();
    } catch { toast.error('Erreur déverrouillage'); }
  };

  const handleValidateType = async (machineType: string) => {
    // Collecter les blocs de toutes les bornes de ce type
    const typeRows = machineRows.filter(r => r.type === machineType && r.machine && r.blocks.length > 0 && !r.machine.validatedCount && !r.machine.suggestionsCount);
    const machineBlocks = typeRows.map(r => ({
      machineId: r.machine!.id,
      blocks: r.blocks.map(b => ({ client: b.client, dateStart: b.dateStart })),
    }));
    try {
      const result = await agendaService.validateType(machineType, machineBlocks);
      toast.success(result.message);
      loadData();
    } catch { toast.error('Erreur validation'); }
  };

  const dateRange = useMemo(() => {
    const d = parseISO(currentDate);
    switch (viewMode) {
      case 'day': return { from: currentDate, to: currentDate };
      case 'week': {
        const s = startOfWeek(d, { weekStartsOn: 1 });
        const e = endOfWeek(d, { weekStartsOn: 1 });
        return { from: format(s, 'yyyy-MM-dd'), to: format(e, 'yyyy-MM-dd') };
      }
      case 'month': {
        const s = startOfMonth(d);
        const e = endOfMonth(d);
        return { from: format(s, 'yyyy-MM-dd'), to: format(e, 'yyyy-MM-dd') };
      }
    }
  }, [currentDate, viewMode]);

  const days = useMemo(() =>
    eachDayOfInterval({ start: parseISO(dateRange.from), end: parseISO(dateRange.to) }),
    [dateRange]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allocs, stockData, machinesData] = await Promise.all([
        agendaService.getAllocations(dateRange.from, dateRange.to),
        agendaService.getStock(dateRange.from, dateRange.to),
        agendaService.getMachines(),
      ]);
      setAllocations(allocs);
      setStock(stockData);
      setMachines(machinesData);
    } catch {
      toast.error('Erreur chargement agenda');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { loadData(); }, [loadData]);

  const navDate = (dir: 'prev' | 'next' | 'today') => {
    const d = parseISO(currentDate);
    if (dir === 'today') { setCurrentDate(format(new Date(), 'yyyy-MM-dd')); return; }
    const fn = dir === 'next'
      ? viewMode === 'day' ? addDays : viewMode === 'week' ? addWeeks : addMonths
      : viewMode === 'day' ? subDays : viewMode === 'week' ? subWeeks : subMonths;
    setCurrentDate(format(fn(d, 1), 'yyyy-MM-dd'));
  };

  const title = useMemo(() => {
    const d = parseISO(currentDate);
    switch (viewMode) {
      case 'day': return format(d, 'EEEE d MMMM yyyy', { locale: fr });
      case 'week': {
        const s = startOfWeek(d, { weekStartsOn: 1 });
        const e = endOfWeek(d, { weekStartsOn: 1 });
        return `${format(s, 'd MMM', { locale: fr })} — ${format(e, 'd MMM yyyy', { locale: fr })}`;
      }
      case 'month': return format(d, 'MMMM yyyy', { locale: fr });
    }
  }, [currentDate, viewMode]);

  // Compute stock locally from allocations — always accurate
  const activeStockDate = selectedStockDate || format(new Date(), 'yyyy-MM-dd');
  const activeStock = useMemo(() => {
    if (!stock?.totalByType) return null;

    // Count occupied machines for the selected date from allocation blocks
    const occupied: Record<string, number> = {};
    for (const block of allocations) {
      if (block.dateStart <= activeStockDate && block.dateEnd >= activeStockDate) {
        const type = block.produit;
        if (type && type !== '?') {
          occupied[type] = (occupied[type] || 0) + 1;
        }
      }
    }

    const availability: Record<string, { total: number; occupied: number; horsService: number; available: number }> = {};
    for (const [type, total] of Object.entries(stock.totalByType)) {
      const hs = stock.horsServiceByType[type] || 0;
      const occ = occupied[type] || 0;
      availability[type] = { total, occupied: occ + hs, horsService: hs, available: Math.max(0, total - occ - hs) };
    }

    return { date: activeStockDate, availability };
  }, [stock, allocations, activeStockDate]);

  // Types that always show all machines (even empty rows)
  const ALWAYS_SHOW_ALL = ['Vegas', 'Smakk', 'Ring'];

  // Build machine rows: all Vegas/Smakk/Ring machines + occupied others
  const machineRows = useMemo(() => {
    const filtered = filterType ? allocations.filter(a => a.produit === filterType) : allocations;

    const rowMap = new Map<string, { key: string; type: string; numero: string; color: string; horsService: boolean; blocks: AllocationBlock[]; machine?: AgendaMachine }>();

    // Pre-populate rows for Vegas, Smakk, Ring (all machines even if empty)
    const typesToShow = filterType ? [filterType].filter(t => ALWAYS_SHOW_ALL.includes(t)) : ALWAYS_SHOW_ALL;
    for (const type of typesToShow) {
      const typeMachines = machines[type] || [];
      for (const m of typeMachines) {
        const key = `${type}-${m.numero}`;
        rowMap.set(key, {
          key,
          type,
          numero: m.numero,
          color: m.couleur || TYPE_COLORS[type] || '#6B7280',
          horsService: m.horsService || false,
          blocks: [],
          machine: m,
        });
      }
    }

    // Helper: check if a block overlaps with any existing blocks in a row
    function hasConflict(existingBlocks: AllocationBlock[], newBlock: AllocationBlock): boolean {
      return existingBlocks.some(b => b.dateStart <= newBlock.dateEnd && b.dateEnd >= newBlock.dateStart);
    }

    // Step 1: place assigned blocks on their specific machine row
    const unassignedBlocks: AllocationBlock[] = [];
    for (const block of filtered) {
      if (block.machineNumero) {
        // Use machine type when product is unknown
        const effectiveType = (block.produit === '?' && block.machineType) ? block.machineType : block.produit;
        const effectiveColor = effectiveType !== '?' ? (TYPE_COLORS[effectiveType] || block.produitCouleur || '#6B7280') : (block.produitCouleur || '#6B7280');
        const key = `${effectiveType}-${block.machineNumero}`;
        // If the row already exists (pre-populated), just add the block
        if (rowMap.has(key)) {
          rowMap.get(key)!.blocks.push(block);
        } else {
          rowMap.set(key, {
            key, type: effectiveType, numero: block.machineNumero,
            color: effectiveColor,
            horsService: false, blocks: [],
          });
          rowMap.get(key)!.blocks.push(block);
        }
      } else {
        unassignedBlocks.push(block);
      }
    }

    // Step 2: place unassigned blocks on the first free row (sorted by numero)
    // Get sorted rows per type for proper V1, V2, V3... order
    const sortedRowsByType: Record<string, Array<{ key: string; type: string; numero: string; color: string; horsService: boolean; blocks: AllocationBlock[]; machine?: AgendaMachine }>> = {};
    for (const [, row] of rowMap) {
      if (!sortedRowsByType[row.type]) sortedRowsByType[row.type] = [];
      sortedRowsByType[row.type]!.push(row);
    }
    for (const type of Object.keys(sortedRowsByType)) {
      sortedRowsByType[type]!.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
    }

    for (const block of unassignedBlocks) {
      const typeRows = sortedRowsByType[block.produit] || [];
      let placed = false;
      for (const row of typeRows) {
        if (!hasConflict(row.blocks, block)) {
          row.blocks.push({ ...block, _unassigned: true } as any);
          placed = true;
          break;
        }
      }
      if (!placed) {
        const key = `${block.produit}-unassigned-${block.client.substring(0, 20)}`;
        if (!rowMap.has(key)) {
          rowMap.set(key, {
            key, type: block.produit, numero: '—',
            color: block.produitCouleur || TYPE_COLORS[block.produit] || '#6B7280',
            horsService: false, blocks: [],
          });
        }
        rowMap.get(key)!.blocks.push({ ...block, _unassigned: true } as any);
      }
    }

    // Sort: by type order, then by numero
    const rows = Array.from(rowMap.values());
    rows.sort((a, b) => {
      const ai = MACHINE_TYPE_ORDER.indexOf(a.type);
      const bi = MACHINE_TYPE_ORDER.indexOf(b.type);
      if (ai !== bi) return ai - bi;
      return a.numero.localeCompare(b.numero, undefined, { numeric: true });
    });

    return rows;
  }, [allocations, filterType, machines]);


  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">Agenda Machines</h1>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors disabled:opacity-50"
          >
            <ArrowPathIcon className={clsx('h-4 w-4', syncing && 'animate-spin')} />
            {syncing ? 'Sync...' : 'Sync'}
          </button>
          <button
            onClick={handleOptimize}
            disabled={optimizing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
          >
            <BoltIcon className="h-4 w-4" />
            {optimizing ? 'Optimisation...' : 'Optimiser'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['day', 'week', 'month'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  viewMode === m ? 'bg-primary-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                {m === 'day' ? 'Jour' : m === 'week' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>
          {/* Nav */}
          <button onClick={() => navDate('prev')} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button onClick={() => navDate('today')} className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-medium">
            Aujourd'hui
          </button>
          <button onClick={() => navDate('next')} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-gray-700 capitalize">{title}</span>
        </div>
      </div>

      {/* Stock bar — clickable to filter */}
      {activeStock && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">
              Stock {selectedStockDate ? format(parseISO(selectedStockDate), 'EEEE d MMMM', { locale: fr }) : "aujourd'hui"}
            </span>
            {(filterType || selectedStockDate) && (
              <button onClick={() => { setFilterType(null); setSelectedStockDate(null); }} className="text-xs text-gray-400 hover:text-gray-600">
                ✕ réinitialiser
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {MACHINE_TYPE_ORDER.map(type => {
              const data = activeStock.availability[type];
              if (!data) return null;
              const color = TYPE_COLORS[type] || '#6B7280';
              const isFiltered = filterType === type;
              const effectiveTotal = data.total - data.horsService;
              const pct = effectiveTotal > 0 ? Math.round((data.available / effectiveTotal) * 100) : 0;
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(isFiltered ? null : type)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
                    isFiltered
                      ? 'ring-2 ring-offset-1 border-transparent shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  )}
                  style={isFiltered ? { backgroundColor: lighten(color, 0.85), borderColor: color, outlineColor: color } : undefined}
                >
                  <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <div className="text-left">
                    <div className="text-xs font-semibold text-gray-800">{type}</div>
                    <div className="flex items-center gap-1.5">
                      <span className={clsx('text-lg font-bold tabular-nums leading-none', data.available > 0 ? 'text-green-600' : 'text-red-600')}>
                        {data.available}
                      </span>
                      <span className="text-xs text-gray-400">/ {effectiveTotal}</span>
                    </div>
                  </div>
                  <div className="w-10 h-10 relative flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15" fill="none"
                        stroke={pct > 30 ? '#22c55e' : pct > 0 ? '#f97316' : '#ef4444'}
                        strokeWidth="3"
                        strokeDasharray={`${pct * 0.942} 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-gray-500">{pct}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Gantt table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : machineRows.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FunnelIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Aucune machine immobilisée sur cette période
        </div>
      ) : (
        <div className="border border-gray-100 rounded-lg overflow-auto bg-white">
          <table className="w-full border-collapse" style={{ minWidth: viewMode === 'day' ? 600 : viewMode === 'week' ? 900 : 1200 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-20 bg-gray-50 border-b border-r border-gray-100/80 px-2 py-1.5 text-left text-[11px] font-semibold text-gray-500 uppercase w-[120px] min-w-[120px]">
                  Machine
                </th>
                {days.map(day => {
                  const isToday = isSameDay(day, new Date());
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const isSelected = selectedStockDate === dayStr;
                  return (
                    <th
                      key={dayStr}
                      onClick={() => setSelectedStockDate(isSelected ? null : dayStr)}
                      className={clsx(
                        'border-b border-r border-gray-100/80 px-1 py-1 text-center cursor-pointer transition-colors',
                        isSelected && 'bg-primary-100',
                        isToday && !isSelected && 'bg-primary-50',
                        isWeekend && !isToday && !isSelected && 'bg-gray-100',
                      )}
                    >
                      <div className="text-[10px] text-gray-400 uppercase">{format(day, 'EEE', { locale: fr })}</div>
                      <div className={clsx(
                        'text-sm font-bold',
                        isToday ? 'text-primary-600' : 'text-gray-700'
                      )}>{format(day, 'd')}</div>
                      {viewMode !== 'week' && <div className="text-[10px] text-gray-400">{format(day, 'MMM', { locale: fr })}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Group rows by type with type separator */}
              {(() => {
                let lastType = '';
                return machineRows.map(row => {
                  const showTypeSeparator = row.type !== lastType;
                  lastType = row.type;
                  const isDropTarget = dragBlock && dropTargetKey === row.key && (dragBlock.produit === row.type || dragBlock.produit === '?');
                  const isHS = row.horsService;

                  return (
                    <tr
                      key={row.key}
                      className={clsx(
                        'group',
                        isHS ? 'bg-gray-100/80 opacity-50' : 'hover:bg-gray-50/50',
                        isDropTarget && !isHS && 'ring-2 ring-inset ring-primary-400 bg-primary-50/40'
                      )}
                      onDragOver={(e) => {
                        if (isHS) return;
                        if (!dragBlock || (dragBlock.produit !== row.type && dragBlock.produit !== '?')) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTargetKey(row.key);
                      }}
                      onDragLeave={() => setDropTargetKey(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropTargetKey(null);
                        if (dragBlock) {
                          handleDrop(dragBlock, row.key);
                          setDragBlock(null);
                        }
                      }}
                    >
                      {/* Machine label */}
                      <td className={clsx(
                        'sticky left-0 z-10 border-b border-r border-gray-50 px-1.5 py-0',
                        isDropTarget ? 'bg-primary-50' : 'bg-white group-hover:bg-gray-50'
                      )}>
                        {(() => {
                        const m = row.machine;
                        const hasBlocks = row.blocks.length > 0;
                        const isValidated = m && m.validatedCount > 0;
                        const hasSuggestionsSent = m && m.suggestionsCount > 0;
                        const canValidate = m && hasBlocks && !isValidated && !hasSuggestionsSent;
                        // Check if any row of this type has blocks to validate
                        const typeHasBlocksToValidate = showTypeSeparator && machineRows.some(r =>
                          r.type === row.type && r.blocks.length > 0 && r.machine && !r.machine.validatedCount && !r.machine.suggestionsCount
                        );

                        return showTypeSeparator ? (
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: isHS ? '#9CA3AF' : row.color }} />
                            <span className="text-[10px] font-bold" style={{ color: isHS ? '#9CA3AF' : row.color }}>{row.type}</span>
                            <span className={clsx('text-[10px] font-bold', isHS ? 'text-gray-400' : 'text-gray-800')}>{row.numero}</span>
                            {isHS && <span className="text-[9px] font-bold text-red-400 bg-red-50 px-1 rounded">HS</span>}
                            {!isHS && canValidate && (
                              <button onClick={(e) => { e.stopPropagation(); handleValidateMachine(m!.id, row.blocks); }}
                                className="ml-auto p-0.5 rounded bg-green-500 text-white hover:bg-green-600 transition-colors" title="Envoyer en préparation">
                                <CheckCircleIcon className="h-3 w-3" />
                              </button>
                            )}
                            {!isHS && (hasSuggestionsSent || isValidated) && (
                              <button onClick={(e) => { e.stopPropagation(); handleUnlockMachine(m!.id); }}
                                className="ml-auto p-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors" title="Déverrouiller">
                                <LockOpenIcon className="h-3 w-3" />
                              </button>
                            )}
                            {typeHasBlocksToValidate && (
                              <button onClick={(e) => { e.stopPropagation(); handleValidateType(row.type); }}
                                className="p-0.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors text-[8px] font-bold px-1" title={`Valider toutes les ${row.type}`}>
                                Tout
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 pl-[18px]">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: isHS ? '#9CA3AF' : row.color }} />
                            <span className={clsx('text-[10px] font-semibold', isHS ? 'text-gray-400' : 'text-gray-700')}>{row.numero}</span>
                            {isHS && <span className="text-[9px] font-bold text-red-400 bg-red-50 px-1 rounded">HS</span>}
                            {!isHS && canValidate && (
                              <button onClick={(e) => { e.stopPropagation(); handleValidateMachine(m!.id, row.blocks); }}
                                className="ml-auto p-0.5 rounded bg-green-500 text-white hover:bg-green-600 transition-colors" title="Envoyer en préparation">
                                <CheckCircleIcon className="h-3 w-3" />
                              </button>
                            )}
                            {!isHS && (hasSuggestionsSent || isValidated) && (
                              <button onClick={(e) => { e.stopPropagation(); handleUnlockMachine(m!.id); }}
                                className="ml-auto p-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors" title="Déverrouiller">
                                <LockOpenIcon className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        );
                      })()}
                      </td>
                      {/* Single merged cell for all days — blocks are positioned absolutely across the full width */}
                      <td
                        colSpan={days.length}
                        className="border-b border-gray-50 p-0 h-[26px] relative"
                        onDragOver={(e) => {
                          if (isHS) return;
                          if (!dragBlock || (dragBlock.produit !== row.type && dragBlock.produit !== '?')) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDropTargetKey(row.key);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetKey(null);
                          if (dragBlock) { handleDrop(dragBlock, row.key); setDragBlock(null); }
                        }}
                      >
                        {/* Day grid lines */}
                        <div className="absolute inset-0 flex">
                          {days.map((day, di) => {
                            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                            const isToday = isSameDay(day, new Date());
                            return (
                              <div
                                key={di}
                                className={clsx(
                                  'flex-1 border-r border-gray-50 last:border-r-0',
                                  isWeekend && 'bg-gray-50/40',
                                  isToday && 'bg-primary-50/30',
                                )}
                              />
                            );
                          })}
                        </div>
                        {/* Blocks as continuous bars */}
                        {row.blocks.map(block => {
                          // Calculate position as % of the total row width
                          const totalDays = days.length;
                          const firstDayStr = format(days[0]!, 'yyyy-MM-dd');
                          const lastDayStr = format(days[totalDays - 1]!, 'yyyy-MM-dd');

                          // Clamp block to visible range
                          const blockStart = block.dateStart < firstDayStr ? firstDayStr : block.dateStart;
                          const blockEnd = block.dateEnd > lastDayStr ? lastDayStr : block.dateEnd;

                          const startDayIndex = days.findIndex(d => format(d, 'yyyy-MM-dd') === blockStart);
                          const endDayIndex = days.findIndex(d => format(d, 'yyyy-MM-dd') === blockEnd);
                          if (startDayIndex === -1 || endDayIndex === -1) return null;

                          const isClampedStart = block.dateStart < firstDayStr;
                          const isClampedEnd = block.dateEnd > lastDayStr;

                          // Position within day: time as fraction of day column (6h-24h)
                          const startTimeFrac = isClampedStart ? 0 : timeToPercent(block.timeStart) / 100;
                          const endTimeFrac = isClampedEnd ? 1 : timeToPercent(block.timeEnd) / 100;

                          const leftPct = ((startDayIndex + startTimeFrac) / totalDays) * 100;
                          const rightPct = ((endDayIndex + endTimeFrac) / totalDays) * 100;
                          const widthPct = Math.max(rightPct - leftPct, 1.5);

                          const clientShort = block.client.length > (widthPct > 15 ? 30 : 14)
                            ? block.client.substring(0, widthPct > 15 ? 30 : 14) + '…'
                            : block.client;

                          const isUnassigned = (block as any)._unassigned;

                          let wasDragged = false;
                          return (
                            <div
                              key={block.id}
                              draggable
                              onDragStart={(e) => {
                                wasDragged = true;
                                setDragBlock(block);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', block.id);
                              }}
                              onDragEnd={() => { setDragBlock(null); setDropTargetKey(null); setTimeout(() => { wasDragged = false; }, 100); }}
                              onClick={() => { if (!wasDragged) setSelectedBlock(block); }}
                              className={clsx(
                                'absolute top-[1px] bottom-[1px] cursor-grab overflow-hidden flex items-center justify-between px-1 hover:brightness-95 transition-all z-[1]',
                                dragBlock?.id === block.id && 'opacity-50 ring-2 ring-primary-500'
                              )}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                backgroundColor: lighten(row.color, isUnassigned ? 0.75 : 0.6),
                                borderRadius: `${isClampedStart ? '0' : '4px'} ${isClampedEnd ? '0' : '4px'} ${isClampedEnd ? '0' : '4px'} ${isClampedStart ? '0' : '4px'}`,
                                borderLeft: isUnassigned ? `2px dashed ${row.color}` : 'none',
                                borderRight: isUnassigned ? `2px dashed ${row.color}` : 'none',
                              }}
                              title={`${block.client}\n${block.produit} ${block.machineNumero || '(non attribué)'}\n${block.dateStart} ${block.timeStart} → ${block.dateEnd} ${block.timeEnd}${isUnassigned ? '\n⚠ Borne non attribuée' : ''}`}
                            >
                              <span className="text-[9px] font-bold flex-shrink-0" style={{ color: row.color }}>
                                {isClampedStart ? '◂' : block.timeStart !== '00:00' ? block.timeStart : ''}
                              </span>
                              <span className="text-[9px] font-medium truncate mx-0.5 text-center" style={{ color: row.color }}>{clientShort}</span>
                              <span className="text-[9px] font-bold flex-shrink-0" style={{ color: row.color }}>
                                {isClampedEnd ? '▸' : block.timeEnd !== '23:59' ? block.timeEnd : ''}
                              </span>
                            </div>
                          );
                        })}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal détail */}
      {selectedBlock && (
        <EventDetailModal
          block={selectedBlock}
          onClose={() => setSelectedBlock(null)}
          onNavigateTournee={(id) => { setSelectedBlock(null); navigate(`/tournees/${id}`); }}
        />
      )}

      {/* Warning marge 4h */}
      {marginWarning && (
        <Modal isOpen onClose={() => setMarginWarning(null)} title="Marge insuffisante" size="md">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  La marge de 4h entre prestations n'est pas respectée :
                </p>
                <ul className="mt-2 space-y-1">
                  {marginWarning.warnings.map((w, i) => (
                    <li key={i} className="text-sm text-amber-700">• {w}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Voulez-vous tout de même assigner <strong>{marginWarning.block.client}</strong> à cette borne ?
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setMarginWarning(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Annuler
              </button>
              <button
                onClick={async () => {
                  const target = findMachineByKey(marginWarning.targetKey);
                  if (target) await doAssign(marginWarning.block, target);
                  setMarginWarning(null);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600"
              >
                Assigner quand même
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Modal de détail d'un événement/contrat */
function EventDetailModal({ block, onClose, onNavigateTournee }: {
  block: AllocationBlock;
  onClose: () => void;
  onNavigateTournee: (tourneeId: string) => void;
}) {
  const color = block.produitCouleur || TYPE_COLORS[block.produit] || '#6B7280';

  const statusLabels: Record<string, { label: string; color: string }> = {
    planifie: { label: 'Planifié (non dispatché)', color: 'bg-gray-100 text-gray-700' },
    immobilisee: { label: 'Machine immobilisée', color: 'bg-orange-100 text-orange-800' },
    livree: { label: 'Livrée (en attente récupération)', color: 'bg-blue-100 text-blue-800' },
  };
  const statusInfo = statusLabels[block.status] || statusLabels.immobilisee;

  return (
    <Modal isOpen onClose={onClose} title="Détail de l'événement" size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-lg border-l-4" style={{ backgroundColor: lighten(color, 0.9), borderLeftColor: color }}>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: color }}>
            {block.produit.substring(0, 2)}
          </div>
          <div className="flex-1">
            <div className="font-bold text-gray-900">{block.produit}{block.machineNumero && ` — ${block.machineNumero}`}</div>
            <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-medium mt-0.5', statusInfo.color)}>{statusInfo.label}</span>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><UserIcon className="h-4 w-4" /> Client</h3>
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            <div className="font-semibold text-gray-900">{block.client}</div>
            {block.clientAdresse && (
              <div className="flex items-start gap-1.5 text-sm text-gray-600"><MapPinIcon className="h-4 w-4 flex-shrink-0 mt-0.5" />{block.clientAdresse}</div>
            )}
            {block.clientTelephone && (
              <div className="flex items-center gap-1.5 text-sm">
                <PhoneIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                <a href={`tel:${block.clientTelephone.replace(/\s/g, '')}`} className="text-primary-600 hover:underline">{block.clientTelephone}</a>
                {block.clientContactNom && <span className="text-gray-400">({block.clientContactNom})</span>}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><CalendarDaysIcon className="h-4 w-4" /> Période d'immobilisation</h3>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Livraison</div>
                <div className="text-sm font-medium text-gray-900">{(() => { try { return format(parseISO(block.dateStart), 'EEE d MMM yyyy', { locale: fr }); } catch { return block.dateStart; } })()}</div>
                <div className="flex items-center gap-1 text-sm text-gray-600"><ClockIcon className="h-3.5 w-3.5" /> {block.timeStart}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-gray-400 font-semibold mb-0.5">Récupération</div>
                <div className="text-sm font-medium text-gray-900">{(() => { try { return format(parseISO(block.dateEnd), 'EEE d MMM yyyy', { locale: fr }); } catch { return block.dateEnd; } })()}</div>
                <div className="flex items-center gap-1 text-sm text-gray-600"><ClockIcon className="h-3.5 w-3.5" /> {block.timeEnd}</div>
              </div>
            </div>
            {block.dateStart !== block.dateEnd && (
              <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
                Durée : {Math.round((parseISO(block.dateEnd).getTime() - parseISO(block.dateStart).getTime()) / 86400000) + 1} jour(s)
              </div>
            )}
          </div>
        </div>

        {block.preparateurNom && (
          <div className="flex items-center gap-2 text-sm">
            <WrenchScrewdriverIcon className="h-4 w-4 text-gray-400" />
            <span className="text-gray-500">Préparateur :</span>
            <span className="font-medium text-gray-900">{block.preparateurNom}</span>
          </div>
        )}

        {block.notesInternes && (
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-gray-700">{block.notesInternes}</div>
          </div>
        )}

        <div className="text-xs text-gray-400 pt-2 border-t border-gray-100">
          Source : {block.source === 'tournee' ? 'Point de tournée' : block.source === 'pending' ? 'Google Calendar (non dispatché)' : 'Préparation'}
        </div>

        {block.tourneeId && (
          <div className="flex justify-end pt-2">
            <button onClick={() => onNavigateTournee(block.tourneeId!)} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">
              <TruckIcon className="h-4 w-4" /> Voir la tournée
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { agendaService, AllocationBlock, StockData, AgendaMachine } from '@/services/agenda.service';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';

const MACHINE_TYPE_ORDER = ['Vegas', 'Smakk', 'Ring', 'Miroir', 'Playbox', 'Aircam', 'Spinner'];

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  en_preparation: { bg: 'bg-yellow-200', border: 'border-yellow-400', text: 'Prépa' },
  prete: { bg: 'bg-blue-200', border: 'border-blue-400', text: 'Prête' },
  en_cours: { bg: 'bg-green-200', border: 'border-green-400', text: 'En cours' },
  a_decharger: { bg: 'bg-purple-200', border: 'border-purple-400', text: 'À décharger' },
  hors_service: { bg: 'bg-red-200', border: 'border-red-400', text: 'HS' },
};

type ViewMode = 'day' | 'week' | 'month';

export default function AgendaPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [allocations, setAllocations] = useState<AllocationBlock[]>([]);
  const [stock, setStock] = useState<StockData | null>(null);
  const [machines, setMachines] = useState<Record<string, AgendaMachine[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(MACHINE_TYPE_ORDER));

  // Compute date range based on view mode
  const dateRange = useMemo(() => {
    const d = parseISO(currentDate);
    switch (viewMode) {
      case 'day':
        return { from: currentDate, to: currentDate };
      case 'week': {
        const start = startOfWeek(d, { weekStartsOn: 1 });
        const end = endOfWeek(d, { weekStartsOn: 1 });
        return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
      }
      case 'month': {
        const start = startOfMonth(d);
        const end = endOfMonth(d);
        return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
      }
    }
  }, [currentDate, viewMode]);

  const days = useMemo(() => {
    return eachDayOfInterval({
      start: parseISO(dateRange.from),
      end: parseISO(dateRange.to),
    });
  }, [dateRange]);

  // Load data
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

  // Navigation
  const navigate = (direction: 'prev' | 'next' | 'today') => {
    const d = parseISO(currentDate);
    if (direction === 'today') {
      setCurrentDate(format(new Date(), 'yyyy-MM-dd'));
      return;
    }
    const delta = direction === 'next' ? 1 : -1;
    switch (viewMode) {
      case 'day': setCurrentDate(format(delta > 0 ? addDays(d, 1) : subDays(d, 1), 'yyyy-MM-dd')); break;
      case 'week': setCurrentDate(format(delta > 0 ? addWeeks(d, 1) : subWeeks(d, 1), 'yyyy-MM-dd')); break;
      case 'month': setCurrentDate(format(delta > 0 ? addMonths(d, 1) : subMonths(d, 1), 'yyyy-MM-dd')); break;
    }
  };

  // Toggle machine type expand/collapse
  const toggleType = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  // Get allocation blocks for a specific machine on a specific day
  const getBlocksForMachineDay = (machineId: string, day: Date): AllocationBlock[] => {
    return allocations.filter(a => {
      if (a.machineId !== machineId) return false;
      const start = parseISO(a.dateStart);
      const end = parseISO(a.dateEnd);
      return isWithinInterval(day, { start, end }) || isSameDay(day, start) || isSameDay(day, end);
    });
  };

  // Stock for today (first day of range or today)
  const todayStock = useMemo(() => {
    if (!stock?.days?.length) return null;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return stock.days.find(d => d.date === todayStr) || stock.days[0];
  }, [stock]);

  // Title
  const title = useMemo(() => {
    const d = parseISO(currentDate);
    switch (viewMode) {
      case 'day': return format(d, 'EEEE d MMMM yyyy', { locale: fr });
      case 'week': {
        const start = startOfWeek(d, { weekStartsOn: 1 });
        const end = endOfWeek(d, { weekStartsOn: 1 });
        return `${format(start, 'd MMM', { locale: fr })} — ${format(end, 'd MMM yyyy', { locale: fr })}`;
      }
      case 'month': return format(d, 'MMMM yyyy', { locale: fr });
    }
  }, [currentDate, viewMode]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Agenda Machines</h1>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['day', 'week', 'month'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  viewMode === mode ? 'bg-primary-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                {mode === 'day' ? 'Jour' : mode === 'week' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('prev')} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button onClick={() => navigate('today')} className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-medium">
            Aujourd'hui
          </button>
          <button onClick={() => navigate('next')} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-gray-700 capitalize ml-2">{title}</span>
        </div>
      </div>

      {/* Stock summary bar */}
      {todayStock && (
        <div className="flex flex-wrap gap-2">
          {MACHINE_TYPE_ORDER.map(type => {
            const data = todayStock.availability[type];
            if (!data) return null;
            const pct = Math.round((data.available / data.total) * 100);
            return (
              <div
                key={type}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white"
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: machines[type]?.[0]?.couleur || '#6B7280' }}
                />
                <span className="text-xs font-medium text-gray-700">{type}</span>
                <span className={clsx(
                  'text-xs font-bold',
                  data.available > 0 ? 'text-green-600' : 'text-red-600'
                )}>
                  {data.available}/{data.total}
                </span>
                <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full', pct > 30 ? 'bg-green-500' : pct > 0 ? 'bg-orange-500' : 'bg-red-500')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px]">
        {Object.entries(STATUS_STYLES).map(([key, style]) => (
          <div key={key} className="flex items-center gap-1">
            <div className={clsx('w-3 h-2 rounded-sm', style.bg, 'border', style.border)} />
            <span className="text-gray-500">{style.text}</span>
          </div>
        ))}
      </div>

      {/* Gantt / Calendar */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-auto bg-white">
          <table className="w-full border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[140px] min-w-[140px]">
                  Machine
                </th>
                {days.map(day => {
                  const isToday = isSameDay(day, new Date());
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  return (
                    <th
                      key={day.toISOString()}
                      className={clsx(
                        'border-b border-r border-gray-200 px-1 py-2 text-center text-xs font-medium min-w-[100px]',
                        isToday && 'bg-primary-50 text-primary-700',
                        isWeekend && !isToday && 'bg-gray-100 text-gray-400',
                        !isToday && !isWeekend && 'text-gray-600'
                      )}
                    >
                      <div>{format(day, 'EEE', { locale: fr })}</div>
                      <div className={clsx('text-sm font-bold', isToday && 'text-primary-600')}>
                        {format(day, 'd')}
                      </div>
                      {viewMode === 'month' && (
                        <div className="text-[10px] text-gray-400">{format(day, 'MMM', { locale: fr })}</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {MACHINE_TYPE_ORDER.map(type => {
                const typeMachines = machines[type] || [];
                if (typeMachines.length === 0) return null;
                const isExpanded = expandedTypes.has(type);
                const typeColor = typeMachines[0]?.couleur || '#6B7280';

                // Count occupied for this type across the range
                const typeAllocCount = allocations.filter(a => a.machineType === type).length;

                return (
                  <tbody key={type}>
                    {/* Type header row */}
                    <tr
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => toggleType(type)}
                    >
                      <td
                        className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-3 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded flex-shrink-0"
                            style={{ backgroundColor: typeColor }}
                          />
                          <span className="text-xs font-bold text-gray-800">{type}</span>
                          <span className="text-[10px] text-gray-400">
                            ({typeMachines.length})
                          </span>
                          {typeAllocCount > 0 && (
                            <span className="text-[10px] font-medium text-orange-600">
                              {typeAllocCount} alloc.
                            </span>
                          )}
                          <span className="text-gray-300 text-xs ml-auto">{isExpanded ? '▾' : '▸'}</span>
                        </div>
                      </td>
                      {days.map(day => {
                        // Show mini summary for the type on this day
                        const dayStr = format(day, 'yyyy-MM-dd');
                        const stockDay = stock?.days.find(s => s.date === dayStr);
                        const avail = stockDay?.availability[type];
                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                        return (
                          <td
                            key={day.toISOString()}
                            className={clsx(
                              'border-b border-r border-gray-200 px-1 py-1 text-center',
                              isWeekend && 'bg-gray-50'
                            )}
                          >
                            {avail && avail.occupied > 0 && (
                              <span className={clsx(
                                'text-[10px] font-bold',
                                avail.available > 0 ? 'text-green-600' : 'text-red-600'
                              )}>
                                {avail.available}/{avail.total}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Individual machine rows */}
                    {isExpanded && typeMachines.map(machine => (
                      <tr key={machine.id} className="hover:bg-gray-50/50">
                        <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 px-3 py-1">
                          <div className="flex items-center gap-2 pl-4">
                            <div
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: typeColor }}
                            />
                            <span className="text-xs text-gray-600 font-medium">{machine.numero}</span>
                            {machine.aDefaut && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-medium">!</span>
                            )}
                          </div>
                        </td>
                        {days.map(day => {
                          const dayBlocks = getBlocksForMachineDay(machine.id, day);
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                          const isToday = isSameDay(day, new Date());

                          return (
                            <td
                              key={day.toISOString()}
                              className={clsx(
                                'border-b border-r border-gray-100 px-0.5 py-0.5 align-top',
                                isWeekend && 'bg-gray-50/50',
                                isToday && 'bg-primary-50/30'
                              )}
                            >
                              {dayBlocks.map(block => {
                                const style = STATUS_STYLES[block.status] || STATUS_STYLES.en_cours;
                                const isStart = block.dateStart === format(day, 'yyyy-MM-dd');
                                const isEnd = block.dateEnd === format(day, 'yyyy-MM-dd');

                                return (
                                  <div
                                    key={block.id}
                                    className={clsx(
                                      'px-1 py-0.5 text-[10px] font-medium truncate border cursor-default',
                                      style.bg, style.border,
                                      isStart && isEnd && 'rounded',
                                      isStart && !isEnd && 'rounded-l border-r-0',
                                      !isStart && isEnd && 'rounded-r border-l-0',
                                      !isStart && !isEnd && 'border-l-0 border-r-0'
                                    )}
                                    title={`${block.client}\n${block.dateStart} ${block.timeStart} → ${block.dateEnd} ${block.timeEnd}\nStatut: ${style.text}`}
                                    style={{ borderColor: typeColor + '80' }}
                                  >
                                    {isStart ? (
                                      <span>{block.client.substring(0, 15)}{block.client.length > 15 ? '…' : ''}</span>
                                    ) : (
                                      <span className="text-gray-400">↔</span>
                                    )}
                                  </div>
                                );
                              })}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

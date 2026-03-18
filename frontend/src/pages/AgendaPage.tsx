import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { agendaService, AllocationBlock, StockData } from '@/services/agenda.service';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
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

export default function AgendaPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [allocations, setAllocations] = useState<AllocationBlock[]>([]);
  const [stock, setStock] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStockDate, setSelectedStockDate] = useState<string | null>(null);

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
      const [allocs, stockData] = await Promise.all([
        agendaService.getAllocations(dateRange.from, dateRange.to),
        agendaService.getStock(dateRange.from, dateRange.to),
      ]);
      setAllocations(allocs);
      setStock(stockData);
    } catch {
      toast.error('Erreur chargement agenda');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { loadData(); }, [loadData]);

  const navigate = (dir: 'prev' | 'next' | 'today') => {
    const d = parseISO(currentDate);
    if (dir === 'today') { setCurrentDate(format(new Date(), 'yyyy-MM-dd')); return; }
    const fn = dir === 'next'
      ? viewMode === 'day' ? addDays : viewMode === 'week' ? addWeeks : addMonths
      : viewMode === 'day' ? subDays : viewMode === 'week' ? subWeeks : subMonths;
    setCurrentDate(format(fn(d, 1), 'yyyy-MM-dd'));
  };

  // Get blocks that overlap a given day
  const blocksForDay = (day: Date): AllocationBlock[] => {
    const ds = format(day, 'yyyy-MM-dd');
    return allocations.filter(a => a.dateStart <= ds && a.dateEnd >= ds);
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

  // Stock for selected date (or today by default)
  const activeStockDate = selectedStockDate || format(new Date(), 'yyyy-MM-dd');
  const activeStock = useMemo(() => {
    if (!stock?.days?.length) return null;
    return stock.days.find(d => d.date === activeStockDate) || stock.days[0];
  }, [stock, activeStockDate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">Agenda Machines</h1>
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
      </div>

      {/* Nav */}
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

      {/* Stock bar */}
      {activeStock && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 font-medium mr-1">
            Stock {selectedStockDate
              ? format(parseISO(selectedStockDate), 'd MMM yyyy', { locale: fr })
              : "aujourd'hui"
            } :
          </span>
          {MACHINE_TYPE_ORDER.map(type => {
            const data = activeStock.availability[type];
            if (!data) return null;
            const color = TYPE_COLORS[type] || '#6B7280';
            return (
              <div key={type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white transition-all">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs font-medium text-gray-700">{type}</span>
                <span className={clsx('text-xs font-bold tabular-nums transition-colors', data.available > 0 ? 'text-green-600' : 'text-red-600')}>
                  {data.available}/{data.total}
                </span>
              </div>
            );
          })}
          {selectedStockDate && (
            <button
              onClick={() => setSelectedStockDate(null)}
              className="text-[10px] text-gray-400 hover:text-gray-600 ml-1"
            >
              ✕ reset
            </button>
          )}
        </div>
      )}

      {/* Calendar grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : viewMode === 'day' ? (
        <DayView day={days[0]!} blocks={blocksForDay(days[0]!)} />
      ) : (
        <div className={clsx(
          'grid gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200',
          viewMode === 'week' ? 'grid-cols-7' : 'grid-cols-7'
        )}>
          {/* Header */}
          {(viewMode === 'month' ? ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] : []).map(d => (
            <div key={d} className="bg-gray-50 text-center py-2 text-xs font-semibold text-gray-500 uppercase">{d}</div>
          ))}
          {/* Month: pad start */}
          {viewMode === 'month' && (() => {
            const firstDay = days[0]!.getDay();
            const pad = firstDay === 0 ? 6 : firstDay - 1;
            return Array.from({ length: pad }, (_, i) => (
              <div key={`pad-${i}`} className="bg-gray-50 min-h-[100px]" />
            ));
          })()}
          {/* Day cells */}
          {days.map(day => {
            const dayBlocks = blocksForDay(day);
            const isToday = isSameDay(day, new Date());
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;

            const dayStr = format(day, 'yyyy-MM-dd');
            const isSelected = selectedStockDate === dayStr;

            return (
              <div
                key={day.toISOString()}
                onClick={() => setSelectedStockDate(isSelected ? null : dayStr)}
                className={clsx(
                  'p-1.5 flex flex-col cursor-pointer transition-colors',
                  viewMode === 'week' ? 'min-h-[400px]' : 'min-h-[100px]',
                  isSelected ? 'bg-primary-50 ring-2 ring-inset ring-primary-500' :
                  isToday ? 'bg-white ring-2 ring-inset ring-primary-300' :
                  isWeekend ? 'bg-gray-50/70' : 'bg-white',
                  !isSelected && 'hover:bg-gray-50'
                )}
              >
                {/* Date header */}
                <div className="flex items-center justify-between mb-1">
                  <span className={clsx(
                    'text-xs font-medium',
                    isToday ? 'bg-primary-500 text-white px-1.5 py-0.5 rounded-full' : 'text-gray-500'
                  )}>
                    {viewMode === 'week'
                      ? format(day, 'EEE d MMM', { locale: fr })
                      : format(day, 'd')
                    }
                  </span>
                  {dayBlocks.length > 0 && (
                    <span className="text-[10px] text-gray-400">{dayBlocks.length} machine{dayBlocks.length > 1 ? 's' : ''}</span>
                  )}
                </div>
                {/* Blocks */}
                <div className="flex-1 space-y-0.5 overflow-y-auto">
                  {dayBlocks.map(block => {
                    const color = block.produitCouleur || TYPE_COLORS[block.produit] || '#6B7280';
                    const isStart = block.dateStart === dayStr;
                    const isEnd = block.dateEnd === dayStr;

                    // Determine time label for this day
                    const timeLabel = isStart && isEnd
                      ? `${block.timeStart}–${block.timeEnd}`
                      : isStart
                        ? `${block.timeStart} →`
                        : isEnd
                          ? `→ ${block.timeEnd}`
                          : 'journée';

                    const clientShort = viewMode === 'month'
                      ? (block.client.length > 12 ? block.client.substring(0, 12) + '…' : block.client)
                      : (block.client.length > 25 ? block.client.substring(0, 25) + '…' : block.client);

                    return (
                      <div
                        key={block.id}
                        className={clsx(
                          'px-1.5 py-1 text-[11px] font-medium cursor-default border-l-[3px] rounded',
                          block.status === 'planifie' && 'border-dashed'
                        )}
                        style={{
                          backgroundColor: lighten(color, block.status === 'planifie' ? 0.9 : 0.82),
                          borderLeftColor: color,
                          color: color,
                        }}
                        title={[
                          block.client,
                          `${block.produit}${block.machineNumero ? ' ' + block.machineNumero : ''}`,
                          `${block.dateStart} ${block.timeStart} → ${block.dateEnd} ${block.timeEnd}`,
                          block.source === 'pending' ? '(non dispatché)' : block.source === 'preparation' ? '(préparation)' : '',
                        ].filter(Boolean).join('\n')}
                      >
                        <div className="flex items-center gap-1">
                          <strong className="flex-shrink-0">{block.produit}</strong>
                          {block.machineNumero && <span className="opacity-60 flex-shrink-0">{block.machineNumero}</span>}
                          <span className="opacity-50 text-[10px] flex-shrink-0">{timeLabel}</span>
                        </div>
                        <div className="truncate opacity-80">{clientShort}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Day view with hourly timeline */
function DayView({ day, blocks }: { day: Date; blocks: AllocationBlock[] }) {
  const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 6h to 23h

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="px-4 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-700 capitalize">
        {format(day, 'EEEE d MMMM yyyy', { locale: fr })}
        <span className="text-gray-400 font-normal ml-2">({blocks.length} machine{blocks.length > 1 ? 's' : ''})</span>
      </div>
      <div className="relative">
        {/* Hour grid */}
        {hours.map(h => (
          <div key={h} className="flex items-start border-b border-gray-100 min-h-[40px]">
            <div className="w-14 flex-shrink-0 text-xs text-gray-400 text-right pr-2 pt-1 border-r border-gray-200 bg-gray-50">
              {String(h).padStart(2, '0')}:00
            </div>
            <div className="flex-1 px-2 py-0.5 flex flex-wrap gap-1">
              {blocks.filter(b => {
                // Show block in this hour slot if it overlaps
                const ds = format(day, 'yyyy-MM-dd');
                const startH = b.dateStart === ds ? parseInt(b.timeStart.split(':')[0]!) : 0;
                const endH = b.dateEnd === ds ? parseInt(b.timeEnd.split(':')[0]!) : 23;
                return h >= startH && h <= endH;
              }).map(block => {
                const color = block.produitCouleur || TYPE_COLORS[block.produit] || '#6B7280';
                const ds = format(day, 'yyyy-MM-dd');
                const startH = block.dateStart === ds ? parseInt(block.timeStart.split(':')[0]!) : 0;
                const isFirstHour = h === startH || (h === 6 && startH < 6);

                if (!isFirstHour) return null; // Only render once

                return (
                  <div
                    key={block.id}
                    className="px-2 py-1 rounded text-xs font-medium border-l-[3px] flex-shrink-0"
                    style={{
                      backgroundColor: lighten(color, 0.82),
                      borderLeftColor: color,
                      color: color,
                    }}
                  >
                    <strong>{block.produit}</strong>
                    {block.machineNumero && <span className="opacity-70"> {block.machineNumero}</span>}
                    {' — '}{block.client}
                    <span className="ml-2 opacity-60">
                      {block.timeStart}–{block.timeEnd}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

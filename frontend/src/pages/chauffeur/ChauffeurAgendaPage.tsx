import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Badge } from '@/components/ui';
import { tourneesService } from '@/services/tournees.service';
import { useEffectiveUser } from '@/hooks/useEffectiveUser';
import { useToast } from '@/hooks/useToast';
import { Tournee } from '@/types';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isToday,
  parseISO,
  startOfWeek,
  endOfWeek,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
  TruckIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import { AgendaSkeleton } from '@/components/ui/PageLoader';
import clsx from 'clsx';

interface TourneesByDate {
  [date: string]: Tournee[];
}

export default function ChauffeurAgendaPage() {
  const { effectiveUser } = useEffectiveUser();
  const navigate = useNavigate();
  const { error: showError } = useToast();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [tourneesByDate, setTourneesByDate] = useState<TourneesByDate>({});
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTournees = useCallback(async () => {
    if (!effectiveUser?.id) return;

    setIsLoading(true);
    try {
      // Fetch tournees for the current month (with some padding for week view)
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);

      const result = await tourneesService.list({
        chauffeurId: effectiveUser.id,
        dateDebut: format(monthStart, 'yyyy-MM-dd'),
        dateFin: format(monthEnd, 'yyyy-MM-dd'),
        limit: 100,
      });

      // Group tournees by date
      const grouped: TourneesByDate = {};
      result.data.forEach((tournee) => {
        const dateKey = tournee.date.split('T')[0];
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(tournee);
      });

      setTourneesByDate(grouped);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [effectiveUser?.id, currentMonth, showError]);

  useEffect(() => {
    fetchTournees();
  }, [fetchTournees]);

  const goToPreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const goToNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const goToToday = () => {
    setCurrentMonth(new Date());
    setSelectedDate(new Date());
  };

  // Generate calendar days
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getDayTournees = (date: Date): Tournee[] => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return tourneesByDate[dateKey] || [];
  };

  const getStatutBadge = (statut: string) => {
    const configs: Record<string, { variant: 'default' | 'info' | 'warning' | 'success' | 'danger'; label: string }> = {
      brouillon: { variant: 'default', label: 'Brouillon' },
      planifiee: { variant: 'info', label: 'Planifiee' },
      en_cours: { variant: 'warning', label: 'En cours' },
      terminee: { variant: 'success', label: 'Terminee' },
      annulee: { variant: 'danger', label: 'Annulee' },
    };
    return configs[statut] || configs.planifiee;
  };

  const handleTourneeClick = (tournee: Tournee) => {
    // Navigate to the tournee page
    navigate('/chauffeur/tournee', { state: { tourneeId: tournee.id } });
  };

  const selectedDateTournees = selectedDate ? getDayTournees(selectedDate) : [];

  // Show skeleton on initial load
  if (isLoading && Object.keys(tourneesByDate).length === 0) {
    return <AgendaSkeleton />;
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <CalendarDaysIcon className="h-7 w-7 text-primary-600" />
          Mon agenda
        </h1>
        <button
          onClick={goToToday}
          className="text-sm text-primary-600 font-medium hover:text-primary-700"
        >
          Aujourd'hui
        </button>
      </div>

      {/* Calendar Card */}
      <Card className="p-4">
        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={goToPreviousMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
          </button>
          <h2 className="text-lg font-semibold text-gray-900 capitalize">
            {format(currentMonth, 'MMMM yyyy', { locale: fr })}
          </h2>
          <button
            onClick={goToNextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRightIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
            <div
              key={day}
              className="text-center text-xs font-medium text-gray-500 py-2"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day) => {
            const dayTournees = getDayTournees(day);
            const hasTournees = dayTournees.length > 0;
            const hasEnCours = dayTournees.some((t) => t.statut === 'en_cours');
            const hasPlanifiee = dayTournees.some((t) => t.statut === 'planifiee');
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const isCurrentMonth = isSameMonth(day, currentMonth);

            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={clsx(
                  'relative aspect-square p-1 rounded-lg transition-colors flex flex-col items-center justify-center min-h-[44px]',
                  !isCurrentMonth && 'opacity-40',
                  isToday(day) && 'ring-2 ring-primary-500',
                  isSelected && 'bg-primary-100',
                  !isSelected && 'hover:bg-gray-100'
                )}
              >
                <span
                  className={clsx(
                    'text-sm font-medium',
                    isToday(day) ? 'text-primary-600' : 'text-gray-900'
                  )}
                >
                  {format(day, 'd')}
                </span>

                {/* Indicator dots */}
                {hasTournees && (
                  <div className="flex gap-0.5 mt-1">
                    {hasEnCours && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                    {hasPlanifiee && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    )}
                    {!hasEnCours && !hasPlanifiee && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            Planifiee
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            En cours
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            Terminee
          </div>
        </div>
      </Card>

      {/* Selected Day Details */}
      {selectedDate && (
        <Card className="p-4">
          <h3 className="font-semibold text-gray-900 mb-3 capitalize">
            {format(selectedDate, 'EEEE d MMMM', { locale: fr })}
          </h3>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : selectedDateTournees.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <CalendarDaysIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Aucune tournee ce jour</p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedDateTournees.map((tournee) => {
                const statutConfig = getStatutBadge(tournee.statut);
                const pointsCount = tournee.nombrePoints || tournee.points?.length || 0;

                return (
                  <button
                    key={tournee.id}
                    onClick={() => handleTourneeClick(tournee)}
                    className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <TruckIcon className="h-5 w-5 text-primary-600" />
                        <span className="font-medium text-gray-900">
                          Tournee
                        </span>
                      </div>
                      <Badge variant={statutConfig.variant}>{statutConfig.label}</Badge>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <MapPinIcon className="h-4 w-4" />
                        {pointsCount} point{pointsCount > 1 ? 's' : ''}
                      </span>
                      {tournee.heureDepart && (
                        <span>
                          Depart: {format(parseISO(tournee.heureDepart), 'HH:mm')}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Upcoming Tournees Summary */}
      {!selectedDate && (
        <Card className="p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Prochaines tournees</h3>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(tourneesByDate)
                .filter(([date]) => new Date(date) >= new Date(format(new Date(), 'yyyy-MM-dd')))
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(0, 5)
                .map(([date, tournees]) => (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(parseISO(date))}
                    className="w-full text-left p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900 capitalize">
                        {format(parseISO(date), 'EEEE d MMMM', { locale: fr })}
                      </span>
                      <span className="text-sm text-gray-500">
                        {tournees.length} tournee{tournees.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>
                ))}

              {Object.keys(tourneesByDate).length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  <p>Aucune tournee planifiee ce mois</p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

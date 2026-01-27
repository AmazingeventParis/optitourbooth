import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Tournee } from '@/types';
import { tourneesService } from '@/services/tournees.service';
import MultiTourneeMap from '@/components/map/MultiTourneeMap';
import { Badge } from '@/components/ui';
import clsx from 'clsx';

const TOURNEE_HEX_COLORS = [
  '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1',
];

export default function MapPopupPage() {
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');

  const [tournees, setTournees] = useState<Tournee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTourneeId, setSelectedTourneeId] = useState<string | null>(null);

  const loadTournees = useCallback(async () => {
    setLoading(true);
    try {
      const tourneesResult = await tourneesService.list({ date: dateParam, limit: 50 });
      const tourneesWithPoints = await Promise.all(
        tourneesResult.data.map(t => tourneesService.getById(t.id))
      );
      setTournees(tourneesWithPoints);
    } catch (error) {
      console.error('Erreur chargement données:', error);
    } finally {
      setLoading(false);
    }
  }, [dateParam]);

  useEffect(() => {
    loadTournees();

    // Rafraîchir toutes les 30 secondes (backup)
    const interval = setInterval(loadTournees, 30000);

    // Écouter les mises à jour de la fenêtre principale via BroadcastChannel
    const channel = new BroadcastChannel('tournees-sync');
    channel.onmessage = (event) => {
      if (event.data?.type === 'tournees-updated' && event.data?.date === dateParam) {
        // Si les données sont incluses, mise à jour instantanée
        if (event.data.tournees) {
          setTournees(event.data.tournees);
        } else {
          // Sinon, recharger depuis l'API
          loadTournees();
        }
      }
    };

    return () => {
      clearInterval(interval);
      channel.close();
    };
  }, [loadTournees, dateParam]);

  const formattedDate = format(new Date(dateParam), 'EEEE d MMMM yyyy', { locale: fr });

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-100">
      {/* Header compact */}
      <div className="bg-white border-b px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Carte des tournées</h1>
          <p className="text-sm text-gray-500 capitalize">{formattedDate}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info" size="sm">
            {tournees.length} tournée(s)
          </Badge>
          <Badge variant="success" size="sm">
            {tournees.reduce((acc, t) => acc + (t.points?.length || 0), 0)} points
          </Badge>
        </div>
      </div>

      {/* Carte plein écran */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
          </div>
        ) : (
          <MultiTourneeMap
            tournees={
              selectedTourneeId
                ? tournees.filter(t => t.id === selectedTourneeId && t.statut !== 'annulee')
                : tournees.filter(t => t.statut !== 'annulee')
            }
            className="h-full w-full"
          />
        )}
      </div>

      {/* Légende en bas */}
      <div className="bg-white border-t px-4 py-2 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 mr-2">Filtrer:</span>
          {tournees.filter(t => t.statut !== 'annulee').map((tournee, index) => {
            const isSelected = selectedTourneeId === tournee.id;
            const color = tournee.chauffeur?.couleur || TOURNEE_HEX_COLORS[index % TOURNEE_HEX_COLORS.length];
            return (
              <button
                key={tournee.id}
                onClick={() => setSelectedTourneeId(isSelected ? null : tournee.id)}
                className={clsx(
                  'flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-all',
                  isSelected
                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                )}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="font-medium">
                  {tournee.chauffeur?.prenom} {tournee.chauffeur?.nom}
                </span>
                <span className="text-gray-400">
                  ({tournee.points?.length || 0} pts)
                </span>
              </button>
            );
          })}
          {selectedTourneeId && (
            <button
              onClick={() => setSelectedTourneeId(null)}
              className="text-xs text-primary-600 hover:underline ml-2"
            >
              Tout afficher
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

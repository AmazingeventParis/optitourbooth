import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Badge, Button } from '@/components/ui';
import { tourneesService } from '@/services/tournees.service';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { Tournee } from '@/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatTime } from '@/utils/format';
import {
  MapPinIcon,
  ClockIcon,
  TruckIcon,
  PlayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

export default function ChauffeurDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { error: showError } = useToast();

  const [tournee, setTournee] = useState<Tournee | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTodayTournee();
  }, []);

  const fetchTodayTournee = async () => {
    setIsLoading(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const result = await tourneesService.list({
        date: today,
        chauffeurId: user?.id,
      });

      // Filtrer les tournées en brouillon (non validées)
      const validTournees = result.data.filter(t => t.statut !== 'brouillon');
      if (validTournees.length > 0) {
        // Get full details
        const fullTournee = await tourneesService.getById(validTournees[0].id);
        setTournee(fullTournee);
      } else {
        setTournee(null);
      }
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatutConfig = (statut: string) => {
    const configs: Record<string, { variant: 'info' | 'warning' | 'success' | 'danger'; label: string; icon: React.ElementType }> = {
      brouillon: { variant: 'info', label: 'Brouillon', icon: ClockIcon },
      planifiee: { variant: 'info', label: 'Planifiée', icon: ClockIcon },
      en_cours: { variant: 'warning', label: 'En cours', icon: TruckIcon },
      terminee: { variant: 'success', label: 'Terminée', icon: CheckCircleIcon },
      annulee: { variant: 'danger', label: 'Annulée', icon: ExclamationTriangleIcon },
    };
    return configs[statut] || configs.planifiee;
  };

  const getPointsStats = () => {
    if (!tournee?.points) return { total: 0, done: 0, inProgress: 0, remaining: 0 };

    const total = tournee.points.length;
    const done = tournee.points.filter((p) => p.statut === 'termine').length;
    const inProgress = tournee.points.filter((p) => p.statut === 'en_cours').length;
    const remaining = tournee.points.filter((p) => p.statut === 'a_faire').length;

    return { total, done, inProgress, remaining };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  const stats = getPointsStats();

  return (
    <div className="p-4 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Bonjour {user?.prenom} !
        </h1>
        <p className="text-gray-500">
          {format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}
        </p>
      </div>

      {/* Today's Tournee */}
      {tournee ? (
        <>
          <Card className="p-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg">Tournée du jour</h2>
                <p className="text-gray-500 text-sm">
                  {tournee.heureDepart && `Départ prévu: ${formatTime(tournee.heureDepart)}`}
                </p>
              </div>
              <Badge variant={getStatutConfig(tournee.statut).variant}>
                {getStatutConfig(tournee.statut).label}
              </Badge>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="bg-gray-100 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-xs text-gray-500">Total</p>
              </div>
              <div className="bg-green-100 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{stats.done}</p>
                <p className="text-xs text-green-600">Terminés</p>
              </div>
              <div className="bg-yellow-100 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-yellow-700">{stats.inProgress}</p>
                <p className="text-xs text-yellow-600">En cours</p>
              </div>
              <div className="bg-blue-100 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{stats.remaining}</p>
                <p className="text-xs text-blue-600">À faire</p>
              </div>
            </div>

            {/* Distance & Duration */}
            {tournee.distanceTotaleKm && (
              <div className="flex gap-4 text-sm text-gray-600 mb-4">
                <span className="flex items-center">
                  <MapPinIcon className="h-4 w-4 mr-1" />
                  {tournee.distanceTotaleKm.toFixed(1)} km
                </span>
                {tournee.dureeTotaleMin && (
                  <span className="flex items-center">
                    <ClockIcon className="h-4 w-4 mr-1" />
                    {Math.floor(tournee.dureeTotaleMin / 60)}h{String(tournee.dureeTotaleMin % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
            )}

            {/* Action Button */}
            <Button
              className="w-full"
              onClick={() => navigate('/chauffeur/tournee')}
            >
              {tournee.statut === 'planifiee' ? (
                <>
                  <PlayIcon className="h-5 w-5 mr-2" />
                  Voir la tournée
                </>
              ) : tournee.statut === 'en_cours' ? (
                <>
                  <TruckIcon className="h-5 w-5 mr-2" />
                  Continuer la tournée
                </>
              ) : (
                <>
                  <CheckCircleIcon className="h-5 w-5 mr-2" />
                  Voir le récapitulatif
                </>
              )}
            </Button>
          </Card>

          {/* Next Point Preview */}
          {tournee.statut === 'en_cours' && tournee.points && (
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Prochain point</h3>
              {(() => {
                const nextPoint = tournee.points
                  .sort((a, b) => a.ordre - b.ordre)
                  .find((p) => p.statut === 'a_faire' || p.statut === 'en_cours');

                if (!nextPoint) {
                  return (
                    <p className="text-gray-500 text-center py-4">
                      Tous les points sont terminés !
                    </p>
                  );
                }

                return (
                  <div
                    className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg cursor-pointer"
                    onClick={() => navigate(`/chauffeur/tournee/point/${nextPoint.id}`)}
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-primary-600 rounded-full flex items-center justify-center text-white font-bold">
                      {nextPoint.ordre + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{nextPoint.client?.nom}</p>
                      <p className="text-sm text-gray-500 truncate">
                        {nextPoint.client?.adresse}
                      </p>
                    </div>
                    <Badge
                      variant={nextPoint.statut === 'en_cours' ? 'warning' : 'default'}
                      size="sm"
                    >
                      {nextPoint.statut === 'en_cours' ? 'En cours' : 'À faire'}
                    </Badge>
                  </div>
                );
              })()}
            </Card>
          )}
        </>
      ) : (
        <Card className="p-8 text-center">
          <TruckIcon className="h-16 w-16 mx-auto text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            Pas de tournée aujourd'hui
          </h2>
          <p className="text-gray-500">
            Aucune tournée n'est planifiée pour vous aujourd'hui.
          </p>
        </Card>
      )}
    </div>
  );
}

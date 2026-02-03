import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Badge, Button } from '@/components/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { RouteMap } from '@/components/map';
import { tourneesService } from '@/services/tournees.service';
import { useAuthStore } from '@/store/authStore';
import { useChauffeurStore } from '@/store/chauffeurStore';
import { useToast } from '@/hooks/useToast';
import { Point } from '@/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { formatTime, formatTimeRange } from '@/utils/format';
import {
  MapPinIcon,
  ClockIcon,
  PlayIcon,
  CheckIcon,
  MapIcon,
  ListBulletIcon,
  PhoneIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

type ViewMode = 'list' | 'map';

// Configs statiques déplacées hors du composant
const POINT_STATUT_CONFIGS: Record<string, { variant: 'default' | 'warning' | 'success' | 'danger'; label: string }> = {
  a_faire: { variant: 'default', label: 'À faire' },
  en_cours: { variant: 'warning', label: 'En cours' },
  termine: { variant: 'success', label: 'Terminé' },
  incident: { variant: 'danger', label: 'Incident' },
  annule: { variant: 'default', label: 'Annulé' },
};

const TYPE_LABELS: Record<string, string> = {
  livraison: 'Livraison',
  ramassage: 'Ramassage',
  livraison_ramassage: 'Liv. + Ram.',
};

const getPointStatutConfig = (statut: string) => {
  return POINT_STATUT_CONFIGS[statut] || POINT_STATUT_CONFIGS.a_faire;
};

const getTypeLabel = (type: string) => {
  return TYPE_LABELS[type] || type;
};

export default function ChauffeurTourneePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { tournee, isLoading, fetchTournee, refreshTournee } = useChauffeurStore();
  const { success, error: showError } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedPointId, setSelectedPointId] = useState<string | undefined>();
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(false);
  const [isFinishDialogOpen, setIsFinishDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user?.id) {
      fetchTournee(user.id);
    }
  }, [user?.id, fetchTournee]);

  const handleStartTournee = async () => {
    if (!tournee) return;

    setIsSaving(true);
    try {
      await tourneesService.start(tournee.id);
      success('Tournée démarrée');
      setIsStartDialogOpen(false);
      refreshTournee();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinishTournee = async () => {
    if (!tournee) return;

    setIsSaving(true);
    try {
      await tourneesService.finish(tournee.id);
      success('Tournée terminée');
      setIsFinishDialogOpen(false);
      refreshTournee();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Callbacks mémorisés pour éviter les re-renders
  const openNavigation = useCallback((point: Point) => {
    if (!point.client?.latitude || !point.client?.longitude) return;

    const address = encodeURIComponent(
      `${point.client.adresse}, ${point.client.codePostal} ${point.client.ville}`
    );

    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${address}`;
    window.open(googleMapsUrl, '_blank');
  }, []);

  const callClient = useCallback((phone: string) => {
    window.location.href = `tel:${phone}`;
  }, []);

  // Mémoisation des points triés
  const sortedPoints = useMemo(() =>
    tournee?.points?.sort((a, b) => a.ordre - b.ordre) || [],
    [tournee?.points]
  );

  // Mémoisation du statut "tous terminés"
  const allDone = useMemo(() =>
    sortedPoints.every((p) => p.statut === 'termine' || p.statut === 'annule'),
    [sortedPoints]
  );

  // Mémoisation des infos depot pour RouteMap
  const depotInfo = useMemo(() =>
    tournee?.depotLatitude && tournee?.depotLongitude
      ? {
          latitude: tournee.depotLatitude,
          longitude: tournee.depotLongitude,
          adresse: tournee.depotAdresse,
        }
      : undefined,
    [tournee?.depotLatitude, tournee?.depotLongitude, tournee?.depotAdresse]
  );

  // Callback mémorisé pour le click sur un point de la carte
  const handlePointClick = useCallback((point: Point) => {
    setSelectedPointId(point.id);
    if (tournee?.statut === 'en_cours') {
      navigate(`/chauffeur/tournee/point/${point.id}`);
    }
  }, [navigate, tournee?.statut]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!tournee) {
    return (
      <div className="p-4">
        <Card className="p-8 text-center">
          <MapPinIcon className="h-16 w-16 mx-auto text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            Pas de tournée
          </h2>
          <p className="text-gray-500 mb-4">
            Aucune tournée n'est planifiée pour vous aujourd'hui.
          </p>
          <Button variant="secondary" onClick={() => navigate('/chauffeur')}>
            Retour à l'accueil
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="p-4 bg-white border-b">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-bold text-lg">
              {format(new Date(tournee.date), 'EEEE d MMMM', { locale: fr })}
            </h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="flex items-center">
                <MapPinIcon className="h-4 w-4 mr-1" />
                {sortedPoints.length} points
              </span>
              {tournee.distanceTotaleKm && (
                <span>{tournee.distanceTotaleKm.toFixed(1)} km</span>
              )}
            </div>
          </div>

          {/* Status Actions */}
          {tournee.statut === 'planifiee' && (
            <Button size="sm" onClick={() => setIsStartDialogOpen(true)}>
              <PlayIcon className="h-4 w-4 mr-1" />
              Démarrer
            </Button>
          )}
          {tournee.statut === 'en_cours' && allDone && (
            <Button size="sm" onClick={() => setIsFinishDialogOpen(true)}>
              <CheckIcon className="h-4 w-4 mr-1" />
              Terminer
            </Button>
          )}
        </div>

        {/* View Toggle */}
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('list')}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors',
              viewMode === 'list'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600'
            )}
          >
            <ListBulletIcon className="h-4 w-4" />
            Liste
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors',
              viewMode === 'map'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600'
            )}
          >
            <MapIcon className="h-4 w-4" />
            Carte
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'list' ? (
          <div className="h-full overflow-y-auto p-4 space-y-3">
            {sortedPoints.map((point, index) => {
              const statutConfig = getPointStatutConfig(point.statut);
              const isActive = point.statut === 'a_faire' || point.statut === 'en_cours';

              return (
                <div
                  key={point.id}
                  onClick={() => {
                    setSelectedPointId(point.id);
                    if (tournee.statut === 'en_cours' && isActive) {
                      navigate(`/chauffeur/tournee/point/${point.id}`);
                    }
                  }}
                >
                  <Card
                    className={clsx(
                      'p-4 cursor-pointer transition-all',
                      point.id === selectedPointId && 'ring-2 ring-primary-500',
                      !isActive && 'opacity-60'
                    )}
                  >
                  <div className="flex gap-3">
                    {/* Number Badge */}
                    <div
                      className={clsx(
                        'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-white',
                        point.statut === 'termine'
                          ? 'bg-green-500'
                          : point.statut === 'en_cours'
                          ? 'bg-yellow-500'
                          : point.statut === 'incident'
                          ? 'bg-red-500'
                          : 'bg-primary-600'
                      )}
                    >
                      {point.statut === 'termine' ? (
                        <CheckIcon className="h-5 w-5" />
                      ) : (
                        index + 1
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-medium truncate">{point.client?.nom}</p>
                        <Badge variant={statutConfig.variant} size="sm">
                          {statutConfig.label}
                        </Badge>
                      </div>

                      <p className="text-sm text-gray-500 mb-2">
                        {point.client?.adresse}, {point.client?.codePostal} {point.client?.ville}
                      </p>

                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="px-2 py-0.5 bg-gray-100 rounded">
                          {getTypeLabel(point.type)}
                        </span>
                        {(point.creneauDebut || point.creneauFin) && (
                          <span className="flex items-center">
                            <ClockIcon className="h-3 w-3 mr-1" />
                            {formatTimeRange(point.creneauDebut, point.creneauFin)}
                          </span>
                        )}
                        {point.heureArriveeEstimee && (
                          <span className="text-primary-600">
                            ETA: {formatTime(point.heureArriveeEstimee)}
                          </span>
                        )}
                      </div>

                      {/* Quick Actions */}
                      {isActive && tournee.statut === 'en_cours' && (
                        <div className="flex gap-2 mt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openNavigation(point);
                            }}
                          >
                            <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-1" />
                            Itinéraire
                          </Button>
                          {(point.client?.telephone || point.client?.contactTelephone) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                callClient(point.client?.contactTelephone || point.client?.telephone || '');
                              }}
                            >
                              <PhoneIcon className="h-4 w-4 mr-1" />
                              Appeler
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
                </div>
              );
            })}
          </div>
        ) : (
          <RouteMap
            points={sortedPoints}
            depot={depotInfo}
            selectedPointId={selectedPointId}
            onPointClick={handlePointClick}
            className="h-full"
          />
        )}
      </div>

      {/* Start Tournee Dialog */}
      <ConfirmDialog
        isOpen={isStartDialogOpen}
        onClose={() => setIsStartDialogOpen(false)}
        onConfirm={handleStartTournee}
        title="Démarrer la tournée"
        message="Confirmez-vous le démarrage de votre tournée ?"
        confirmText="Démarrer"
        variant="warning"
        isLoading={isSaving}
      />

      {/* Finish Tournee Dialog */}
      <ConfirmDialog
        isOpen={isFinishDialogOpen}
        onClose={() => setIsFinishDialogOpen(false)}
        onConfirm={handleFinishTournee}
        title="Terminer la tournée"
        message="Tous les points sont terminés. Confirmez-vous la fin de votre tournée ?"
        confirmText="Terminer"
        variant="warning"
        isLoading={isSaving}
      />
    </div>
  );
}

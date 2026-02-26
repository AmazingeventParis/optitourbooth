import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Badge, Button } from '@/components/ui';
import { useChauffeurStore } from '@/store/chauffeurStore';
import { useEffectiveUser } from '@/hooks/useEffectiveUser';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTerminologie } from '@/hooks/queries/useSettings';
import { tourneesService } from '@/services/tournees.service';
import { pushNotificationService } from '@/services/pushNotification.service';
import { formatTime } from '@/utils/format';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DashboardSkeleton } from '@/components/ui/PageLoader';
import {
  MapPinIcon,
  ClockIcon,
  TruckIcon,
  PlayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  DevicePhoneMobileIcon,
  Cog6ToothIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

interface WeeklyStats {
  kmParcourus: number;
  tempsRoute: number; // en minutes
  pointsLivres: number;
  tourneesTerminees: number;
}

interface DeferredPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function ChauffeurDashboard() {
  const navigate = useNavigate();
  const { effectiveUser } = useEffectiveUser();
  const { tournee, isLoading, fetchTournee } = useChauffeurStore();
  const termi = useTerminologie();

  // Weekly stats state
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats>({
    kmParcourus: 0,
    tempsRoute: 0,
    pointsLivres: 0,
    tourneesTerminees: 0,
  });
  const [isLoadingWeekly, setIsLoadingWeekly] = useState(true);

  // App install & permissions state
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<DeferredPrompt | null>(null);
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
  const [hasGPSPermission, setHasGPSPermission] = useState(false);

  useEffect(() => {
    if (effectiveUser?.id) {
      fetchTournee(effectiveUser.id);
    }
  }, [effectiveUser?.id, fetchTournee]);

  // Check app installation & permissions on mount
  useEffect(() => {
    // Check if app is installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsAppInstalled(true);
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as DeferredPrompt);
      setCanInstall(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Check notification permission
    const checkNotificationPermission = async () => {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          const isSubscribed = await pushNotificationService.isSubscribed();
          setHasNotificationPermission(isSubscribed);
        }
      }
    };

    // Check GPS permission (try to get it without actually requesting)
    const checkGPSPermission = async () => {
      if ('permissions' in navigator) {
        try {
          const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          setHasGPSPermission(result.state === 'granted');
        } catch {
          // Fallback: assume granted if we can't check
          setHasGPSPermission(false);
        }
      }
    };

    checkNotificationPermission();
    checkGPSPermission();

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Fetch weekly stats
  useEffect(() => {
    if (!effectiveUser?.id) return;

    const fetchWeeklyStats = async () => {
      setIsLoadingWeekly(true);
      try {
        const today = new Date();
        const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
        const weekEnd = endOfWeek(today, { weekStartsOn: 1 }); // Sunday

        const result = await tourneesService.list({
          chauffeurId: effectiveUser.id,
          dateDebut: format(weekStart, 'yyyy-MM-dd'),
          dateFin: format(weekEnd, 'yyyy-MM-dd'),
          limit: 100,
        });

        // Calculate stats from completed tournees
        let kmParcourus = 0;
        let tempsRoute = 0;
        let pointsLivres = 0;
        let tourneesTerminees = 0;

        for (const t of result.data) {
          if (t.statut === 'terminee' || t.statut === 'en_cours') {
            kmParcourus += t.distanceTotaleKm || 0;
            tempsRoute += t.dureeTrajetMin || 0; // Temps de route uniquement (pas temps total)

            // Count completed points
            if (t.points) {
              pointsLivres += t.points.filter(p => p.statut === 'termine').length;
            } else {
              // If points not included, fetch the tournee details
              try {
                const fullTournee = await tourneesService.getById(t.id);
                pointsLivres += fullTournee.points?.filter(p => p.statut === 'termine').length || 0;
              } catch {
                // Ignore errors, just count what we can
              }
            }

            if (t.statut === 'terminee') {
              tourneesTerminees++;
            }
          }
        }

        setWeeklyStats({
          kmParcourus,
          tempsRoute,
          pointsLivres,
          tourneesTerminees,
        });
      } catch (err) {
        console.error('Error fetching weekly stats:', err);
      } finally {
        setIsLoadingWeekly(false);
      }
    };

    fetchWeeklyStats();
  }, [effectiveUser?.id]);

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

  const handleInstallApp = async () => {
    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;

      if (outcome === 'accepted') {
        setIsAppInstalled(true);
        setCanInstall(false);
      }

      setInstallPrompt(null);
    } catch (error) {
      console.error('Install error:', error);
    }
  };

  const handleReconfigurePermissions = () => {
    // Clear onboarding flag to force re-configuration
    localStorage.removeItem('chauffeur_onboarding_complete');
    navigate('/chauffeur/onboarding');
  };

  // Pull-to-refresh
  const handlePullRefresh = useCallback(async () => {
    if (effectiveUser?.id) {
      await fetchTournee(effectiveUser.id, true);
    }
  }, [effectiveUser?.id, fetchTournee]);

  const { containerRef, PullIndicator } = usePullToRefresh({ onRefresh: handlePullRefresh });

  const showAppConfigCard = !isAppInstalled || !hasNotificationPermission || !hasGPSPermission;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const stats = getPointsStats();

  return (
    <div className="p-4 space-y-6" ref={containerRef}>
      {PullIndicator}
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Bonjour {effectiveUser?.prenom} !
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          {format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}
        </p>
      </div>

      {/* App Configuration Card */}
      {showAppConfigCard && (
        <Card className="p-4 bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-primary-200">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-shrink-0 w-12 h-12 bg-primary-600 rounded-full flex items-center justify-center">
              <DevicePhoneMobileIcon className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-lg text-gray-900 mb-1">
                Configurer l'application
              </h2>
              <p className="text-sm text-gray-600 mb-3">
                Pour une expérience optimale, activez toutes les fonctionnalités
              </p>

              {/* Status checklist */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  {isAppInstalled ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-600" />
                  ) : (
                    <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
                  )}
                  <span className={isAppInstalled ? 'text-green-700 font-medium' : 'text-gray-700'}>
                    {isAppInstalled ? 'Application installée' : 'Application non installée'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  {hasGPSPermission ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-600" />
                  ) : (
                    <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
                  )}
                  <span className={hasGPSPermission ? 'text-green-700 font-medium' : 'text-gray-700'}>
                    {hasGPSPermission ? 'GPS autorisé' : 'GPS non autorisé'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  {hasNotificationPermission ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-600" />
                  ) : (
                    <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
                  )}
                  <span className={hasNotificationPermission ? 'text-green-700 font-medium' : 'text-gray-700'}>
                    {hasNotificationPermission ? 'Notifications activées' : 'Notifications désactivées'}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                {!isAppInstalled && canInstall && (
                  <Button
                    onClick={handleInstallApp}
                    className="w-full bg-primary-600 hover:bg-primary-700"
                  >
                    <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
                    Installer l'application
                  </Button>
                )}

                <Button
                  onClick={handleReconfigurePermissions}
                  variant={!hasGPSPermission || !hasNotificationPermission ? 'primary' : 'secondary'}
                  className="w-full"
                >
                  <Cog6ToothIcon className="h-5 w-5 mr-2" />
                  {!hasGPSPermission || !hasNotificationPermission
                    ? 'Configurer les permissions'
                    : 'Reconfigurer'}
                </Button>

                {!isAppInstalled && !canInstall && (
                  <p className="text-xs text-gray-500 text-center mt-1">
                    Sur iOS : Ouvrez Safari, puis Partager &gt; Sur l'écran d'accueil
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Today's Tournee */}
      {tournee ? (
        <>
          <Card className="p-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg">{termi.tournee} du jour</h2>
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
                  Voir la {termi.tournee.toLowerCase()}
                </>
              ) : tournee.statut === 'en_cours' ? (
                <>
                  <TruckIcon className="h-5 w-5 mr-2" />
                  Continuer la {termi.tournee.toLowerCase()}
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
              <h3 className="font-semibold mb-3">Prochain {termi.point.toLowerCase()}</h3>
              {(() => {
                const nextPoint = tournee.points
                  .sort((a, b) => a.ordre - b.ordre)
                  .find((p) => p.statut === 'a_faire' || p.statut === 'en_cours');

                if (!nextPoint) {
                  return (
                    <p className="text-gray-500 text-center py-4">
                      Tous les {termi.point.toLowerCase()}s sont terminés !
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
            Pas de {termi.tournee.toLowerCase()} aujourd'hui
          </h2>
          <p className="text-gray-500">
            Aucune {termi.tournee.toLowerCase()} n'est planifiée pour vous aujourd'hui.
          </p>
        </Card>
      )}

      {/* Weekly Stats */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <ChartBarIcon className="h-5 w-5 text-primary-600" />
          <h2 className="font-semibold text-lg">Ma semaine</h2>
        </div>

        {isLoadingWeekly ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {/* Km parcourus */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-blue-700">
                {weeklyStats.kmParcourus.toFixed(1)}
              </div>
              <div className="text-xs text-blue-600 font-medium">km parcourus</div>
            </div>

            {/* Temps sur la route */}
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-purple-700">
                {Math.floor(weeklyStats.tempsRoute / 60)}h{String(weeklyStats.tempsRoute % 60).padStart(2, '0')}
              </div>
              <div className="text-xs text-purple-600 font-medium">sur la route</div>
            </div>

            {/* Points livrés */}
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-green-700">
                {weeklyStats.pointsLivres}
              </div>
              <div className="text-xs text-green-600 font-medium">{termi.point.toLowerCase()}s livrés</div>
            </div>
          </div>
        )}

        {/* Week range indicator */}
        <div className="mt-3 text-center text-xs text-gray-400">
          Semaine du {format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'd MMM', { locale: fr })} au {format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'd MMM', { locale: fr })}
        </div>
      </Card>
    </div>
  );
}

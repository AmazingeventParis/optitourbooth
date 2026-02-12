import { useEffect, useState, useCallback, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSocketStore } from '@/store/socketStore';
import { socketService } from '@/services/socket.service';
import { pushNotificationService } from '@/services/pushNotification.service';
import { useGPSTracking } from '@/hooks/useGPSTracking';
import { useEffectiveUser } from '@/hooks/useEffectiveUser';
import { useChauffeurStore } from '@/store/chauffeurStore';
import { tourneesService } from '@/services/tournees.service';
import { format } from 'date-fns';
import {
  HomeIcon,
  MapIcon,
  CalendarDaysIcon,
  ArrowRightOnRectangleIcon,
  SignalIcon,
  SignalSlashIcon,
  BellIcon,
  XMarkIcon,
  ShieldCheckIcon,
  EyeIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

export default function ChauffeurLayout() {
  const { token, logout, stopImpersonation, impersonatedChauffeur } = useAuthStore();
  const { effectiveUser, isImpersonating } = useEffectiveUser();
  const { clearTournee } = useChauffeurStore();
  const { isConnected, setConnected } = useSocketStore();
  const navigate = useNavigate();

  // Check if onboarding is complete (skip for admins impersonating)
  useEffect(() => {
    if (!isImpersonating && effectiveUser?.role === 'chauffeur') {
      const onboardingComplete = localStorage.getItem('chauffeur_onboarding_complete');
      if (!onboardingComplete) {
        navigate('/chauffeur/onboarding', { replace: true });
      }
    }
  }, [effectiveUser, isImpersonating, navigate]);

  // Track if the chauffeur has an active tournee (en_cours status)
  const [hasActiveTournee, setHasActiveTournee] = useState(false);

  // Push notification state
  const [pushState, setPushState] = useState<'loading' | 'prompt' | 'subscribed' | 'denied' | 'unsupported'>('loading');
  const [showPushBanner, setShowPushBanner] = useState(false);

  // Clear tournee store when effective user changes (impersonation switch)
  const prevEffectiveUserId = useRef(effectiveUser?.id);
  useEffect(() => {
    if (prevEffectiveUserId.current && prevEffectiveUserId.current !== effectiveUser?.id) {
      clearTournee();
    }
    prevEffectiveUserId.current = effectiveUser?.id;
  }, [effectiveUser?.id, clearTournee]);

  // Check for active tournee
  const checkActiveTournee = useCallback(async () => {
    if (!effectiveUser?.id) return;

    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const result = await tourneesService.list({
        date: today,
        chauffeurId: effectiveUser.id,
        limit: 10,
      });

      // Check if any tournee is en_cours
      const hasActive = result.data.some((t) => t.statut === 'en_cours');
      setHasActiveTournee(hasActive);
    } catch (error) {
      console.error('[ChauffeurLayout] Error checking active tournee:', error);
    }
  }, [effectiveUser?.id]);

  // Initialize socket connection
  useEffect(() => {
    if (!token) return;

    const connectSocket = async () => {
      try {
        await socketService.connect(token);
        setConnected(true);
      } catch (error) {
        console.error('[ChauffeurLayout] Socket connection failed:', error);
        setConnected(false);
      }
    };

    connectSocket();

    // Check push notification status (don't request permission yet)
    // Skip when impersonating - admin doesn't need chauffeur push notifications
    if (!isImpersonating) {
      (async () => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          setPushState('unsupported');
          return;
        }
        if (Notification.permission === 'denied') {
          setPushState('denied');
          return;
        }
        const subscribed = await pushNotificationService.isSubscribed();
        if (subscribed) {
          // Already subscribed, just re-sync with server
          pushNotificationService.init().catch(console.error);
          setPushState('subscribed');
        } else {
          setPushState('prompt');
          setShowPushBanner(true);
        }
      })();
    }

    // Check for active tournee initially
    checkActiveTournee();

    // Periodically check for active tournee (every 30 seconds)
    const tourneeCheckInterval = setInterval(checkActiveTournee, 30000);

    return () => {
      clearInterval(tourneeCheckInterval);
      socketService.disconnect();
      setConnected(false);
    };
  }, [token, setConnected, checkActiveTournee, isImpersonating]);

  // Listen for tournee updates from socket
  useEffect(() => {
    const handleTourneeUpdate = () => {
      // Re-check active tournee when we get an update
      checkActiveTournee();
    };

    socketService.on('tournee:updated', handleTourneeUpdate);

    return () => {
      socketService.off('tournee:updated', handleTourneeUpdate);
    };
  }, [checkActiveTournee]);

  // GPS tracking - always enabled when connected (including admin impersonation)
  const { isTracking, error: gpsError, accuracy } = useGPSTracking({
    enabled: isConnected,
    impersonatedChauffeurId: isImpersonating ? impersonatedChauffeur?.id : undefined,
  });

  const handleEnablePush = async () => {
    const success = await pushNotificationService.init();
    if (success) {
      setPushState('subscribed');
    } else if (Notification.permission === 'denied') {
      setPushState('denied');
    }
    setShowPushBanner(false);
  };

  const handleReturnToAdmin = () => {
    stopImpersonation();
    clearTournee();
    navigate('/');
  };

  const handleLogout = () => {
    socketService.disconnect();
    logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Accueil', href: '/chauffeur', icon: HomeIcon },
    { name: 'Tournée', href: '/chauffeur/tournee', icon: MapIcon },
    { name: 'Agenda', href: '/chauffeur/agenda', icon: CalendarDaysIcon },
  ];

  // Show help link if GPS error or notifications denied
  const showHelpLink = gpsError || pushState === 'denied';

  // Format GPS accuracy for display
  const getAccuracyText = () => {
    if (!accuracy) return '';
    if (accuracy <= 10) return 'GPS précis';
    if (accuracy <= 30) return 'GPS moyen';
    return 'GPS imprécis';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-primary-600 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center">
            <svg
              className="h-6 w-6 text-primary-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-lg">OptiTour</h1>
            <p className="text-xs text-primary-200">
              {effectiveUser?.prenom} {effectiveUser?.nom}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection status indicator */}
          <div
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-full text-xs',
              isConnected ? 'bg-green-500/20 text-green-100' : 'bg-red-500/20 text-red-100'
            )}
            title={isConnected ? 'Connecté au serveur' : 'Déconnecté du serveur'}
          >
            {isConnected ? (
              <SignalIcon className="h-4 w-4" />
            ) : (
              <SignalSlashIcon className="h-4 w-4" />
            )}
          </div>

          {/* GPS tracking indicator - always visible */}
          <div
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-full text-xs',
              isTracking && !gpsError
                ? 'bg-blue-500/20 text-blue-100'
                : 'bg-orange-500/20 text-orange-100'
            )}
            title={
              gpsError
                ? gpsError
                : isTracking
                ? `GPS actif - ${getAccuracyText()}`
                : 'GPS inactif'
            }
          >
            <span className="relative flex h-2 w-2">
              {isTracking && !gpsError && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </>
              )}
              {(!isTracking || gpsError) && (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
              )}
            </span>
            <span className="hidden sm:inline">
              {gpsError ? 'GPS erreur' : isTracking ? 'GPS' : 'GPS off'}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-primary-700 transition-colors"
            title="Déconnexion"
          >
            <ArrowRightOnRectangleIcon className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* Impersonation banner */}
      {isImpersonating && (
        <div className="bg-amber-500 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <EyeIcon className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm font-medium">
              Mode Chauffeur : {effectiveUser?.prenom} {effectiveUser?.nom}
            </span>
          </div>
          <button
            onClick={handleReturnToAdmin}
            className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
          >
            <ShieldCheckIcon className="h-4 w-4" />
            Retour Admin
          </button>
        </div>
      )}

      {/* Push notification banner */}
      {showPushBanner && pushState === 'prompt' && !isImpersonating && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex items-center gap-3">
          <BellIcon className="h-6 w-6 text-blue-600 flex-shrink-0" />
          <p className="text-sm text-blue-800 flex-1">
            Activez les notifications pour être alerté des nouvelles tournées.
          </p>
          <button
            onClick={handleEnablePush}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex-shrink-0"
          >
            Activer
          </button>
          <button
            onClick={() => setShowPushBanner(false)}
            className="p-1 text-blue-400 hover:text-blue-600 flex-shrink-0"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Help banner for permission issues */}
      {showHelpLink && !isImpersonating && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 flex items-center gap-3">
          <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600 flex-shrink-0" />
          <p className="text-sm text-yellow-800 flex-1">
            {gpsError ? 'GPS désactivé' : 'Notifications désactivées'} - Certaines fonctionnalités sont limitées
          </p>
          <button
            onClick={() => navigate('/chauffeur/aide-permissions')}
            className="px-3 py-1.5 bg-yellow-600 text-white text-sm font-medium rounded-lg hover:bg-yellow-700 flex-shrink-0"
          >
            Aide
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet context={{ hasActiveTournee, checkActiveTournee }} />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 safe-area-bottom">
        <div className="flex justify-around max-w-md mx-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              end={item.href === '/chauffeur'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center px-4 py-2 rounded-lg transition-colors',
                  isActive
                    ? 'text-primary-600 bg-primary-50'
                    : 'text-gray-500 hover:text-gray-700'
                )
              }
            >
              <item.icon className="h-6 w-6" />
              <span className="text-xs mt-1">{item.name}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

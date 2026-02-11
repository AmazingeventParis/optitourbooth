import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { pushNotificationService } from '@/services/pushNotification.service';
import {
  MapPinIcon,
  BellIcon,
  DevicePhoneMobileIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';

type PermissionStatus = 'pending' | 'granted' | 'denied';

interface DeferredPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function ChauffeurOnboardingPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [gpsStatus, setGpsStatus] = useState<PermissionStatus>('pending');
  const [notifStatus, setNotifStatus] = useState<PermissionStatus>('pending');
  const [installPrompt, setInstallPrompt] = useState<DeferredPrompt | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as DeferredPrompt);
      setCanInstall(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleRequestGPS = async () => {
    try {
      // Request GPS permission by trying to get current position
      await new Promise<void>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('GPS non supporté'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          () => {
            setGpsStatus('granted');
            resolve();
          },
          (error) => {
            if (error.code === error.PERMISSION_DENIED) {
              setGpsStatus('denied');
            }
            reject(error);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          }
        );
      });
    } catch (error) {
      console.error('GPS permission error:', error);
      setGpsStatus('denied');
    }
  };

  const handleRequestNotifications = async () => {
    try {
      const success = await pushNotificationService.init();
      setNotifStatus(success ? 'granted' : 'denied');
    } catch (error) {
      console.error('Notification permission error:', error);
      setNotifStatus('denied');
    }
  };

  const handleInstallApp = async () => {
    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;

      if (outcome === 'accepted') {
        setIsInstalled(true);
        setCanInstall(false);
      }

      setInstallPrompt(null);
    } catch (error) {
      console.error('Install error:', error);
    }
  };

  const handleComplete = () => {
    // Mark onboarding as complete
    localStorage.setItem('chauffeur_onboarding_complete', 'true');
    navigate('/chauffeur', { replace: true });
  };

  const steps = [
    {
      title: 'Bienvenue sur OptiTour',
      description: 'Votre assistant de livraison intelligent',
      icon: DevicePhoneMobileIcon,
      content: (
        <div className="text-center space-y-4">
          <DevicePhoneMobileIcon className="h-24 w-24 mx-auto text-primary-600" />
          <h2 className="text-2xl font-bold text-gray-900">Bienvenue !</h2>
          <p className="text-gray-600">
            OptiTour vous aide à gérer vos tournées de livraison facilement.
          </p>
          <p className="text-sm text-gray-500">
            Pour une expérience optimale, nous avons besoin de configurer quelques permissions.
          </p>
          <Button onClick={() => setCurrentStep(1)} className="mt-6">
            Commencer
            <ArrowRightIcon className="h-5 w-5 ml-2" />
          </Button>
        </div>
      ),
    },
    {
      title: 'Localisation GPS',
      description: 'Suivi de votre position en temps réel',
      icon: MapPinIcon,
      content: (
        <div className="text-center space-y-4">
          <MapPinIcon className="h-24 w-24 mx-auto text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Position GPS</h2>
          <div className="text-left bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <p className="text-sm text-blue-900 font-medium">Pourquoi activé le GPS ?</p>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Optimiser votre itinéraire en temps réel</li>
              <li>Informer les clients de votre arrivée</li>
              <li>Simplifier la navigation</li>
            </ul>
          </div>

          {gpsStatus === 'pending' && (
            <Button onClick={handleRequestGPS} className="mt-6 w-full">
              Autoriser la localisation
            </Button>
          )}

          {gpsStatus === 'granted' && (
            <div className="flex items-center justify-center gap-2 text-green-600 mt-6">
              <CheckCircleIcon className="h-6 w-6" />
              <span className="font-medium">GPS autorisé !</span>
            </div>
          )}

          {gpsStatus === 'denied' && (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-red-600 mt-6">
                <XCircleIcon className="h-6 w-6" />
                <span className="font-medium">GPS refusé</span>
              </div>
              <p className="text-sm text-red-600">
                Veuillez autoriser l'accès dans les paramètres de votre navigateur
              </p>
            </div>
          )}

          <Button
            variant="secondary"
            onClick={() => setCurrentStep(2)}
            disabled={gpsStatus !== 'granted'}
            className="mt-4 w-full"
          >
            Continuer
            <ArrowRightIcon className="h-5 w-5 ml-2" />
          </Button>
        </div>
      ),
    },
    {
      title: 'Notifications',
      description: 'Restez informé de vos tournées',
      icon: BellIcon,
      content: (
        <div className="text-center space-y-4">
          <BellIcon className="h-24 w-24 mx-auto text-purple-600" />
          <h2 className="text-2xl font-bold text-gray-900">Notifications</h2>
          <div className="text-left bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2">
            <p className="text-sm text-purple-900 font-medium">Pourquoi activer les notifications ?</p>
            <ul className="text-sm text-purple-800 space-y-1 list-disc list-inside">
              <li>Être alerté des nouvelles tournées</li>
              <li>Recevoir les modifications en temps réel</li>
              <li>Ne manquer aucune information importante</li>
            </ul>
          </div>

          {notifStatus === 'pending' && (
            <Button onClick={handleRequestNotifications} className="mt-6 w-full">
              Autoriser les notifications
            </Button>
          )}

          {notifStatus === 'granted' && (
            <div className="flex items-center justify-center gap-2 text-green-600 mt-6">
              <CheckCircleIcon className="h-6 w-6" />
              <span className="font-medium">Notifications activées !</span>
            </div>
          )}

          {notifStatus === 'denied' && (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-red-600 mt-6">
                <XCircleIcon className="h-6 w-6" />
                <span className="font-medium">Notifications refusées</span>
              </div>
              <p className="text-sm text-red-600">
                Veuillez autoriser l'accès dans les paramètres de votre navigateur
              </p>
              <Button
                variant="secondary"
                onClick={() => setCurrentStep(3)}
                className="mt-4 w-full"
              >
                Continuer quand même
                <ArrowRightIcon className="h-5 w-5 ml-2" />
              </Button>
            </div>
          )}

          {notifStatus === 'granted' && (
            <Button
              onClick={() => setCurrentStep(3)}
              className="mt-4 w-full"
            >
              Continuer
              <ArrowRightIcon className="h-5 w-5 ml-2" />
            </Button>
          )}
        </div>
      ),
    },
    {
      title: 'Installer l\'application',
      description: 'Accès rapide depuis votre écran d\'accueil',
      icon: DevicePhoneMobileIcon,
      content: (
        <div className="text-center space-y-4">
          <DevicePhoneMobileIcon className="h-24 w-24 mx-auto text-green-600" />
          <h2 className="text-2xl font-bold text-gray-900">Installer l'application</h2>

          {isInstalled ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 text-green-600">
                <CheckCircleIcon className="h-6 w-6" />
                <span className="font-medium">Application installée !</span>
              </div>
              <p className="text-gray-600">
                Vous pouvez maintenant accéder à OptiTour depuis votre écran d'accueil.
              </p>
            </div>
          ) : canInstall ? (
            <div className="space-y-4">
              <div className="text-left bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                <p className="text-sm text-green-900 font-medium">Pourquoi installer ?</p>
                <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
                  <li>Accès instantané depuis l'écran d'accueil</li>
                  <li>Fonctionne comme une vraie application</li>
                  <li>Mode plein écran</li>
                  <li>Disponible hors ligne</li>
                </ul>
              </div>
              <Button onClick={handleInstallApp} className="mt-6 w-full">
                Installer l'application
              </Button>
              <Button
                variant="secondary"
                onClick={handleComplete}
                className="w-full"
              >
                Ignorer et continuer
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-gray-600">
                {isInstalled
                  ? 'L\'application est déjà installée !'
                  : 'Installation non disponible sur ce navigateur. Vous pouvez utiliser l\'application directement dans votre navigateur.'
                }
              </p>
              <p className="text-sm text-gray-500">
                Sur iOS : Ouvrez dans Safari, appuyez sur le bouton Partager puis "Sur l'écran d'accueil"
              </p>
            </div>
          )}

          {!canInstall && (
            <Button onClick={handleComplete} className="mt-6 w-full">
              Commencer à utiliser OptiTour
              <ArrowRightIcon className="h-5 w-5 ml-2" />
            </Button>
          )}

          {canInstall && !isInstalled && (
            <Button
              variant="ghost"
              onClick={handleComplete}
              className="mt-2 w-full text-gray-500"
            >
              Passer cette étape
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-1 flex-1 mx-1 rounded-full transition-colors ${
                  index <= currentStep ? 'bg-primary-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <p className="text-center text-sm text-gray-500">
            Étape {currentStep + 1} sur {steps.length}
          </p>
        </div>

        {/* Content card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {steps[currentStep].content}
        </div>

        {/* Skip button */}
        {currentStep > 0 && (
          <div className="mt-4 text-center">
            <button
              onClick={handleComplete}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Passer la configuration
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

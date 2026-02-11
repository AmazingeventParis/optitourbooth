import { Button } from '@/components/ui';
import { useNavigate } from 'react-router-dom';
import {
  MapPinIcon,
  BellIcon,
  DevicePhoneMobileIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

export default function ChauffeurPermissionsHelp() {
  const navigate = useNavigate();

  const handleResetOnboarding = () => {
    localStorage.removeItem('chauffeur_onboarding_complete');
    navigate('/chauffeur/onboarding', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate('/chauffeur')}
          className="mb-4"
        >
          <ArrowLeftIcon className="h-5 w-5 mr-2" />
          Retour
        </Button>

        <div className="bg-white rounded-xl shadow-lg p-8 space-y-8">
          <div className="text-center">
            <ExclamationTriangleIcon className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Aide aux permissions
            </h1>
            <p className="text-gray-600">
              Comment activer les permissions GPS et notifications
            </p>
          </div>

          {/* GPS Permission */}
          <div className="border border-blue-200 rounded-lg p-6 bg-blue-50">
            <div className="flex items-center gap-3 mb-4">
              <MapPinIcon className="h-8 w-8 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">
                Activer le GPS
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Sur Android (Chrome)</h3>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Appuyez sur l'icône cadenas (🔒) ou les 3 points dans la barre d'adresse</li>
                  <li>Sélectionnez "Paramètres du site" ou "Autorisations"</li>
                  <li>Trouvez "Position" ou "Localisation"</li>
                  <li>Sélectionnez "Autoriser"</li>
                  <li>Rechargez la page</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Sur iOS (Safari)</h3>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Ouvrez Réglages &gt; Safari &gt; Localisation</li>
                  <li>Sélectionnez "Autoriser"</li>
                  <li>Retournez sur l'application et rechargez la page</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Notification Permission */}
          <div className="border border-purple-200 rounded-lg p-6 bg-purple-50">
            <div className="flex items-center gap-3 mb-4">
              <BellIcon className="h-8 w-8 text-purple-600" />
              <h2 className="text-xl font-bold text-gray-900">
                Activer les notifications
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Sur Android (Chrome)</h3>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Appuyez sur l'icône cadenas (🔒) ou les 3 points dans la barre d'adresse</li>
                  <li>Sélectionnez "Paramètres du site" ou "Autorisations"</li>
                  <li>Trouvez "Notifications"</li>
                  <li>Sélectionnez "Autoriser"</li>
                  <li>Rechargez la page</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Sur iOS (Safari)</h3>
                <p className="text-sm text-gray-700 mb-2">
                  Les notifications web ne sont disponibles que si l'application est installée sur l'écran d'accueil :
                </p>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Appuyez sur le bouton Partager (⎙)</li>
                  <li>Sélectionnez "Sur l'écran d'accueil"</li>
                  <li>Appuyez sur "Ajouter"</li>
                  <li>Ouvrez l'app depuis votre écran d'accueil</li>
                  <li>Les notifications seront demandées automatiquement</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Install App */}
          <div className="border border-green-200 rounded-lg p-6 bg-green-50">
            <div className="flex items-center gap-3 mb-4">
              <DevicePhoneMobileIcon className="h-8 w-8 text-green-600" />
              <h2 className="text-xl font-bold text-gray-900">
                Installer l'application
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Sur Android (Chrome)</h3>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Une bannière "Installer l'application" devrait apparaître en bas</li>
                  <li>Sinon : Menu (⋮) &gt; "Installer l'application" ou "Ajouter à l'écran d'accueil"</li>
                  <li>Confirmez l'installation</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Sur iOS (Safari)</h3>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Appuyez sur le bouton Partager (⎙) en bas</li>
                  <li>Faites défiler et sélectionnez "Sur l'écran d'accueil"</li>
                  <li>Appuyez sur "Ajouter"</li>
                  <li>L'icône OptiTour apparaîtra sur votre écran d'accueil</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Reset Button */}
          <div className="pt-6 border-t border-gray-200">
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-600 mb-3">
                Si vous avez toujours des problèmes, vous pouvez recommencer la configuration :
              </p>
              <Button onClick={handleResetOnboarding} variant="secondary">
                Recommencer la configuration
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

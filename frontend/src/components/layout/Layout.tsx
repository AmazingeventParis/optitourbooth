import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { socketService } from '@/services/socket.service';
import { useNotificationStore } from '@/store/notificationStore';
import { useAuthStore } from '@/store/authStore';

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });
  const addNotification = useNotificationStore((s) => s.addNotification);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  // Charger les notifications depuis la DB au login
  useEffect(() => {
    if (!token) return;
    fetchNotifications();
  }, [token, fetchNotifications]);

  // Connecter le socket pour recevoir les notifications en temps réel
  useEffect(() => {
    if (!token) return;
    socketService.connect(token).catch((err) => {
      console.error('[Layout] Socket connection failed:', err);
    });
  }, [token]);

  // Écouter les événements de préparation en temps réel
  // Les notifs socket servent à afficher instantanément — elles seront dédupliquées au prochain fetchNotifications
  useEffect(() => {
    const handlePrepCreated = (data: { machine: string; client: string; preparateur: string; dateEvenement: string }) => {
      const dateEvt = data.dateEvenement ? new Date(data.dateEvenement).toLocaleDateString('fr-FR') : '';
      addNotification({
        type: 'preparation_created',
        title: 'Nouvelle préparation',
        body: `${data.machine} préparée pour ${data.client}`,
        metadata: {
          client: data.client,
          dateEvenement: dateEvt,
          machine: data.machine,
          preparateur: data.preparateur,
        },
      });
      // Rafraîchir depuis la DB après un court délai pour remplacer le doublon temps réel par la version DB
      setTimeout(() => fetchNotifications(), 2000);
    };

    const handlePrepUpdated = (data: { machine: string; client: string; statut: string; preparateur?: string }) => {
      const statutLabels: Record<string, string> = {
        prete: 'prête',
        en_cours: 'en cours',
        a_decharger: 'à décharger',
        archivee: 'archivée',
        defaut: 'en défaut',
        hors_service: 'hors service',
      };
      addNotification({
        type: 'preparation_updated',
        title: 'Mise à jour',
        body: `${data.machine} (${data.client}) → ${statutLabels[data.statut] || data.statut}`,
        metadata: {
          client: data.client,
          machine: data.machine,
          statut: statutLabels[data.statut] || data.statut,
          preparateur: data.preparateur || '',
        },
      });
      setTimeout(() => fetchNotifications(), 2000);
    };

    socketService.on('preparation:created', handlePrepCreated);
    socketService.on('preparation:updated', handlePrepUpdated);

    return () => {
      socketService.off('preparation:created', handlePrepCreated);
      socketService.off('preparation:updated', handlePrepUpdated);
    };
  }, [addNotification, fetchNotifications]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar mobile */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Sidebar desktop */}
      <div
        className={`hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:flex-col transition-all duration-300 ${
          collapsed ? 'lg:w-20' : 'lg:w-64'
        }`}
      >
        <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} />
      </div>

      {/* Contenu principal - isolate crée un stacking context pour contenir les z-index de la map */}
      <div className={`isolate transition-all duration-300 ${collapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
        {/* Bouton menu mobile uniquement */}
        <div className="sticky top-0 z-30 flex h-14 items-center bg-gray-50 px-4 lg:hidden">
          <button
            type="button"
            className="-m-2.5 p-2.5 text-gray-700"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="sr-only">Ouvrir menu</span>
            <Bars3Icon className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <main className="py-6 px-4 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth.service';
import { PageLoader } from '@/components/ui/PageLoader';

// Layouts (chargés immédiatement car toujours utilisés)
import Layout from '@/components/layout/Layout';
import ChauffeurLayout from '@/components/layout/ChauffeurLayout';

// Page de login (chargée immédiatement car c'est le point d'entrée)
import LoginPage from '@/pages/LoginPage';

// ============================================
// LAZY LOADING - Pages Admin
// Ces pages sont chargées uniquement quand nécessaire
// ============================================
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const VehiculesPage = lazy(() => import('@/pages/VehiculesPage'));
const ClientsPage = lazy(() => import('@/pages/ClientsPage'));
const ProduitsPage = lazy(() => import('@/pages/ProduitsPage'));
const TourneesPage = lazy(() => import('@/pages/TourneesPage'));
const TourneeDetailPage = lazy(() => import('@/pages/TourneeDetailPage'));
const DailyPlanningPage = lazy(() => import('@/pages/DailyPlanningPage'));
const RapportsPage = lazy(() => import('@/pages/RapportsPage'));
const MapPopupPage = lazy(() => import('@/pages/MapPopupPage'));

// ============================================
// LAZY LOADING - Pages Chauffeur
// ============================================
const ChauffeurDashboard = lazy(() =>
  import('@/pages/chauffeur/ChauffeurDashboard')
);
const ChauffeurTourneePage = lazy(() =>
  import('@/pages/chauffeur/ChauffeurTourneePage')
);
const ChauffeurPointPage = lazy(() =>
  import('@/pages/chauffeur/ChauffeurPointPage')
);
const ChauffeurAgendaPage = lazy(() =>
  import('@/pages/chauffeur/ChauffeurAgendaPage')
);

// ============================================
// Composant Suspense wrapper pour les pages
// ============================================
function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoader />}>
      {children}
    </Suspense>
  );
}

// Composant de redirection si déjà connecté
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (isAuthenticated) {
    // Rediriger selon le rôle
    if (user?.role === 'chauffeur') {
      return <Navigate to="/chauffeur" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// Protection pour les routes admin uniquement
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'chauffeur') {
    return <Navigate to="/chauffeur" replace />;
  }

  return <>{children}</>;
}

// Protection pour les routes chauffeur
function ChauffeurRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Les admins peuvent aussi accéder à l'interface chauffeur
  if (user?.role !== 'chauffeur' && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function App() {
  const { isAuthenticated, setUser } = useAuthStore();

  // Refresh user data on mount (picks up avatarUrl and other changes)
  useEffect(() => {
    if (isAuthenticated) {
      authService.getMe().then(setUser).catch(() => {});
    }
  }, [isAuthenticated, setUser]);

  return (
    <Routes>
      {/* Routes publiques */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      {/* Route Map Popup (sans layout) */}
      <Route
        path="/map-popup"
        element={
          <AdminRoute>
            <LazyPage><MapPopupPage /></LazyPage>
          </AdminRoute>
        }
      />

      {/* Routes Admin */}
      <Route
        path="/"
        element={
          <AdminRoute>
            <Layout />
          </AdminRoute>
        }
      >
        <Route index element={<LazyPage><DashboardPage /></LazyPage>} />
        <Route path="utilisateurs" element={<LazyPage><UsersPage /></LazyPage>} />
        <Route path="vehicules" element={<LazyPage><VehiculesPage /></LazyPage>} />
        <Route path="clients" element={<LazyPage><ClientsPage /></LazyPage>} />
        <Route path="produits" element={<LazyPage><ProduitsPage /></LazyPage>} />
        <Route path="tournees" element={<LazyPage><TourneesPage /></LazyPage>} />
        <Route path="tournees/:id" element={<LazyPage><TourneeDetailPage /></LazyPage>} />
        <Route path="planning" element={<LazyPage><DailyPlanningPage /></LazyPage>} />
        <Route path="historique" element={<LazyPage><TourneesPage /></LazyPage>} />
        <Route path="rapports" element={<LazyPage><RapportsPage /></LazyPage>} />
      </Route>

      {/* Routes Chauffeur */}
      <Route
        path="/chauffeur"
        element={
          <ChauffeurRoute>
            <ChauffeurLayout />
          </ChauffeurRoute>
        }
      >
        <Route index element={<LazyPage><ChauffeurDashboard /></LazyPage>} />
        <Route path="tournee" element={<LazyPage><ChauffeurTourneePage /></LazyPage>} />
        <Route path="tournee/point/:pointId" element={<LazyPage><ChauffeurPointPage /></LazyPage>} />
        <Route path="agenda" element={<LazyPage><ChauffeurAgendaPage /></LazyPage>} />
      </Route>

      {/* Route 404 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

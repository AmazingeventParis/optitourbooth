import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
// Self-hosted Inter font (eliminates Google Fonts external request)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import { setupQueueSync } from '@/utils/offlineQueue';
import { initWebVitals } from '@/utils/webVitals';

// Configuration React Query avec cache optimisé
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Garder les données en cache pendant 5 minutes
      staleTime: 5 * 60 * 1000,
      // Garder en cache même si stale pendant 30 minutes
      gcTime: 30 * 60 * 1000,
      // Retry 2 fois en cas d'erreur
      retry: 2,
      // Ne pas refetch automatiquement au focus de fenêtre
      refetchOnWindowFocus: false,
      // Ne refetch que si les données sont stale (pas à chaque mount)
      refetchOnMount: false,
    },
    mutations: {
      // Retry 1 fois pour les mutations
      retry: 1,
    },
  },
});

// Initialize offline queue sync
setupQueueSync();

// Initialize Web Vitals monitoring
initWebVitals();

// Register service worker with update check
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((registration) => {
    // Check for updates every 5 minutes
    setInterval(() => registration.update(), 5 * 60 * 1000);

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available - prompt user
          if (confirm('Nouvelle version disponible. Mettre à jour ?')) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          }
        }
      });
    });
  }).catch((err) => {
    console.warn('[SW] Registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#fff',
              color: '#374151',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

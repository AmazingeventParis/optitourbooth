import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

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

// Register service worker for push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
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

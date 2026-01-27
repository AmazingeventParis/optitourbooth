import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/authStore';

// Créer l'instance Axios
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur pour ajouter le token aux requêtes
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Intercepteur pour gérer les réponses et erreurs
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;

    // Si erreur 401 et pas déjà en train de refresh
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !(originalRequest as InternalAxiosRequestConfig & { _retry?: boolean })._retry
    ) {
      (originalRequest as InternalAxiosRequestConfig & { _retry?: boolean })._retry = true;

      const refreshToken = useAuthStore.getState().refreshToken;

      if (refreshToken) {
        try {
          // Tenter de refresh le token
          const response = await axios.post(
            `${import.meta.env.VITE_API_URL || '/api'}/auth/refresh`,
            { refreshToken }
          );

          const { token: newToken, refreshToken: newRefreshToken } = response.data.data;

          // Mettre à jour le store
          const { user } = useAuthStore.getState();
          if (user) {
            useAuthStore.getState().setAuth(user, newToken, newRefreshToken);
          }

          // Réessayer la requête originale avec le nouveau token
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        } catch {
          // Refresh échoué, déconnecter l'utilisateur
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
      } else {
        // Pas de refresh token, déconnecter
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    // Formater le message d'erreur
    const errorMessage =
      (error.response?.data as { error?: { message?: string } })?.error?.message ||
      error.message ||
      'Une erreur est survenue';

    return Promise.reject(new Error(errorMessage));
  }
);

export default api;

// Types pour les réponses API
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

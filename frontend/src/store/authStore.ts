import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  roles: Array<'superadmin' | 'admin' | 'chauffeur' | 'preparateur'>;
  nom: string;
  prenom: string;
  telephone?: string;
  avatarUrl?: string;
  actif?: boolean;
  tenantId?: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  impersonatedChauffeur: User | null;

  // Actions
  setAuth: (user: User, token: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
  startImpersonation: (chauffeur: User) => void;
  stopImpersonation: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,
      impersonatedChauffeur: null,

      setAuth: (user, token, refreshToken) =>
        set({
          user,
          token,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
        }),

      setUser: (user) => set({ user }),

      setLoading: (loading) => set({ isLoading: loading }),

      logout: () =>
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
          impersonatedChauffeur: null,
        }),

      startImpersonation: (chauffeur) =>
        set({ impersonatedChauffeur: chauffeur }),

      stopImpersonation: () =>
        set({ impersonatedChauffeur: null }),
    }),
    {
      name: 'optitour-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        impersonatedChauffeur: state.impersonatedChauffeur,
      }),
      onRehydrateStorage: () => (state) => {
        // Une fois réhydraté, on n'est plus en loading
        if (state) {
          state.isLoading = false;
        }
      },
    }
  )
);

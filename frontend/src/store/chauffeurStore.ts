import { create } from 'zustand';
import { Tournee } from '@/types';
import { tourneesService } from '@/services/tournees.service';
import { format } from 'date-fns';

interface ChauffeurState {
  // Data
  tournee: Tournee | null;
  isLoading: boolean;
  error: string | null;
  lastFetch: number | null;

  // Actions
  fetchTournee: (chauffeurId: string, force?: boolean) => Promise<void>;
  setTournee: (tournee: Tournee | null) => void;
  refreshTournee: () => Promise<void>;
  clearTournee: () => void;
}

// Cache duration: 30 seconds
const CACHE_DURATION = 30 * 1000;

export const useChauffeurStore = create<ChauffeurState>((set, get) => ({
  tournee: null,
  isLoading: false,
  error: null,
  lastFetch: null,

  fetchTournee: async (chauffeurId: string, force = false) => {
    const state = get();

    // Skip if already loading
    if (state.isLoading) return;

    // Skip if data is fresh (less than CACHE_DURATION old) and not forced
    if (!force && state.lastFetch && Date.now() - state.lastFetch < CACHE_DURATION && state.tournee) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const result = await tourneesService.list({
        date: today,
        chauffeurId,
      });

      // Filter: only show planifiee or en_cours tournees (not brouillon, annulee, or terminee)
      const validTournees = result.data.filter(t =>
        t.statut === 'planifiee' || t.statut === 'en_cours'
      );

      if (validTournees.length > 0) {
        // Prioritize en_cours over planifiee
        const activeTournee = validTournees.find(t => t.statut === 'en_cours') || validTournees[0];
        const fullTournee = await tourneesService.getById(activeTournee.id);
        set({
          tournee: fullTournee,
          isLoading: false,
          lastFetch: Date.now(),
        });
      } else {
        set({
          tournee: null,
          isLoading: false,
          lastFetch: Date.now(),
        });
      }
    } catch (err) {
      set({
        error: (err as Error).message,
        isLoading: false,
      });
    }
  },

  setTournee: (tournee) => {
    set({ tournee, lastFetch: Date.now() });
  },

  refreshTournee: async () => {
    const state = get();
    if (state.tournee) {
      try {
        const refreshed = await tourneesService.getById(state.tournee.id);
        set({ tournee: refreshed, lastFetch: Date.now() });
      } catch (err) {
        set({ error: (err as Error).message });
      }
    }
  },

  clearTournee: () => {
    set({ tournee: null, lastFetch: null, error: null });
  },
}));

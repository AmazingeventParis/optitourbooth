import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settings.service';
import type { TenantSettings, Terminologie } from '@/types/settings';

export const settingsQueryKey = ['settings'] as const;

/**
 * Hook pour récupérer et cacher les paramètres du tenant.
 * staleTime long car les settings changent rarement.
 */
export function useSettings() {
  return useQuery<TenantSettings>({
    queryKey: settingsQueryKey,
    queryFn: () => settingsService.get(),
    staleTime: 15 * 60 * 1000, // 15 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  });
}

/**
 * Defaults de terminologie (utilisés si settings pas encore chargés)
 */
const DEFAULT_TERMINOLOGIE: Terminologie = {
  tournee: 'Tournée',
  chauffeur: 'Chauffeur',
  point: 'Point',
  vehicule: 'Véhicule',
};

/**
 * Hook simplifié pour récupérer uniquement la terminologie.
 * Retourne toujours un objet valide (defaults si loading/error).
 */
export function useTerminologie(): Terminologie {
  const { data } = useSettings();
  return data?.interfaceUi?.terminologie ?? DEFAULT_TERMINOLOGIE;
}

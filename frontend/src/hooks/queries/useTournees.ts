import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tourneesService } from '@/services/tournees.service';
import { queryKeys } from './queryKeys';
import { Tournee, Point, PaginationMeta } from '@/types';
import toast from 'react-hot-toast';

// Types pour les filtres
interface TourneesFilters {
  page?: number;
  limit?: number;
  date?: string;
  chauffeurId?: string;
  statut?: string;
}

interface CreateTourneeData {
  date: string;
  chauffeurId: string;
  heureDepart?: string;
  depotAdresse?: string;
  notes?: string;
}

interface CreatePointData {
  clientId: string;
  type: 'livraison' | 'ramassage' | 'livraison_ramassage';
  creneauDebut?: string;
  creneauFin?: string;
  notesInternes?: string;
  notesClient?: string;
  produits: Array<{ produitId: string; quantite: number }>;
  options?: Array<{ optionId: string }>;
}

// ============================================
// QUERIES
// ============================================

/**
 * Hook pour récupérer la liste des tournées avec cache
 */
export function useTournees(filters: TourneesFilters = {}) {
  return useQuery({
    queryKey: queryKeys.tournees.list(filters as Record<string, unknown>),
    queryFn: () => tourneesService.list(filters),
    // Garder les données précédentes pendant le chargement
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook pour récupérer une tournée par ID
 */
export function useTournee(id: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.tournees.detail(id!),
    queryFn: () => tourneesService.getById(id!),
    enabled: !!id && (options?.enabled !== false),
    // Données considérées fraîches pendant 2 minutes
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook pour récupérer les stats d'une tournée
 */
export function useTourneeStats(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tournees.stats(id!),
    queryFn: () => tourneesService.calculateStats(id!),
    enabled: !!id,
    staleTime: 60 * 1000, // 1 minute
  });
}

// ============================================
// MUTATIONS AVEC OPTIMISTIC UPDATES
// ============================================

/**
 * Hook pour créer une tournée
 */
export function useCreateTournee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTourneeData) => tourneesService.create(data),
    onSuccess: () => {
      // Invalider les listes pour forcer le refresh
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.lists() });
      toast.success('Tournée créée');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de la création');
    },
  });
}

/**
 * Hook pour mettre à jour une tournée avec optimistic update
 */
export function useUpdateTournee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Tournee> }) =>
      tourneesService.update(id, data),
    // Optimistic update
    onMutate: async ({ id, data }) => {
      // Annuler les requêtes en cours
      await queryClient.cancelQueries({ queryKey: queryKeys.tournees.detail(id) });

      // Sauvegarder l'état précédent
      const previousTournee = queryClient.getQueryData<Tournee>(
        queryKeys.tournees.detail(id)
      );

      // Mise à jour optimiste
      if (previousTournee) {
        queryClient.setQueryData<Tournee>(queryKeys.tournees.detail(id), {
          ...previousTournee,
          ...data,
        });
      }

      return { previousTournee };
    },
    onError: (error, { id }, context) => {
      // Rollback en cas d'erreur
      if (context?.previousTournee) {
        queryClient.setQueryData(queryKeys.tournees.detail(id), context.previousTournee);
      }
      toast.error((error as Error).message || 'Erreur lors de la mise à jour');
    },
    onSettled: (_, __, { id }) => {
      // Toujours revalider après la mutation
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.lists() });
    },
  });
}

/**
 * Hook pour supprimer une tournée avec optimistic update
 */
export function useDeleteTournee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => tourneesService.delete(id),
    // Optimistic update - retirer de la liste immédiatement
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tournees.lists() });

      // Sauvegarder toutes les listes en cache
      const previousLists = queryClient.getQueriesData<{ data: Tournee[]; meta: PaginationMeta }>({
        queryKey: queryKeys.tournees.lists(),
      });

      // Retirer la tournée de toutes les listes en cache
      queryClient.setQueriesData<{ data: Tournee[]; meta: PaginationMeta }>(
        { queryKey: queryKeys.tournees.lists() },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter((t) => t.id !== id),
            meta: { ...old.meta, total: old.meta.total - 1 },
          };
        }
      );

      return { previousLists };
    },
    onError: (error, _, context) => {
      // Restaurer les listes en cas d'erreur
      context?.previousLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      toast.error((error as Error).message || 'Erreur lors de la suppression');
    },
    onSuccess: () => {
      toast.success('Tournée supprimée');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.lists() });
    },
  });
}

/**
 * Hook pour dupliquer une tournée
 */
export function useDuplicateTournee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, newDate }: { id: string; newDate: string }) =>
      tourneesService.duplicate(id, newDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.lists() });
      toast.success('Tournée dupliquée');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de la duplication');
    },
  });
}

/**
 * Hook pour démarrer une tournée
 */
export function useStartTournee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => tourneesService.start(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tournees.detail(id) });
      const previous = queryClient.getQueryData<Tournee>(queryKeys.tournees.detail(id));

      if (previous) {
        queryClient.setQueryData<Tournee>(queryKeys.tournees.detail(id), {
          ...previous,
          statut: 'en_cours',
        });
      }

      return { previous };
    },
    onError: (error, id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.tournees.detail(id), context.previous);
      }
      toast.error((error as Error).message || 'Erreur');
    },
    onSuccess: () => {
      toast.success('Tournée démarrée');
    },
    onSettled: (_, __, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.lists() });
    },
  });
}

/**
 * Hook pour terminer une tournée
 */
export function useFinishTournee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => tourneesService.finish(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tournees.detail(id) });
      const previous = queryClient.getQueryData<Tournee>(queryKeys.tournees.detail(id));

      if (previous) {
        queryClient.setQueryData<Tournee>(queryKeys.tournees.detail(id), {
          ...previous,
          statut: 'terminee',
        });
      }

      return { previous };
    },
    onError: (error, id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.tournees.detail(id), context.previous);
      }
      toast.error((error as Error).message || 'Erreur');
    },
    onSuccess: () => {
      toast.success('Tournée terminée');
    },
    onSettled: (_, __, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.lists() });
    },
  });
}

/**
 * Hook pour optimiser une tournée
 */
export function useOptimizeTournee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => tourneesService.optimize(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.detail(id) });
      toast.success('Tournée optimisée');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de l\'optimisation');
    },
  });
}

/**
 * Hook pour réordonner les points avec optimistic update
 */
export function useReorderPoints() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tourneeId, pointIds }: { tourneeId: string; pointIds: string[] }) =>
      tourneesService.reorderPoints(tourneeId, pointIds),
    onMutate: async ({ tourneeId, pointIds }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tournees.detail(tourneeId) });

      const previousTournee = queryClient.getQueryData<Tournee>(
        queryKeys.tournees.detail(tourneeId)
      );

      if (previousTournee?.points) {
        // Réordonner les points localement
        const pointsMap = new Map(previousTournee.points.map((p) => [p.id, p]));
        const reorderedPoints = pointIds
          .map((id, index) => {
            const point = pointsMap.get(id);
            return point ? { ...point, ordre: index } : null;
          })
          .filter(Boolean) as Point[];

        queryClient.setQueryData<Tournee>(queryKeys.tournees.detail(tourneeId), {
          ...previousTournee,
          points: reorderedPoints,
        });
      }

      return { previousTournee };
    },
    onError: (error, { tourneeId }, context) => {
      if (context?.previousTournee) {
        queryClient.setQueryData(queryKeys.tournees.detail(tourneeId), context.previousTournee);
      }
      toast.error((error as Error).message || 'Erreur');
    },
    onSettled: (_, __, { tourneeId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.detail(tourneeId) });
    },
  });
}

/**
 * Hook pour ajouter un point
 */
export function useAddPoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tourneeId, data }: { tourneeId: string; data: CreatePointData }) =>
      tourneesService.addPoint(tourneeId, data),
    onSuccess: (_, { tourneeId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.detail(tourneeId) });
      toast.success('Point ajouté');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de l\'ajout');
    },
  });
}

/**
 * Hook pour supprimer un point avec optimistic update
 */
export function useDeletePoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tourneeId, pointId }: { tourneeId: string; pointId: string }) =>
      tourneesService.deletePoint(tourneeId, pointId),
    onMutate: async ({ tourneeId, pointId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tournees.detail(tourneeId) });

      const previousTournee = queryClient.getQueryData<Tournee>(
        queryKeys.tournees.detail(tourneeId)
      );

      if (previousTournee?.points) {
        queryClient.setQueryData<Tournee>(queryKeys.tournees.detail(tourneeId), {
          ...previousTournee,
          points: previousTournee.points.filter((p) => p.id !== pointId),
        });
      }

      return { previousTournee };
    },
    onError: (error, { tourneeId }, context) => {
      if (context?.previousTournee) {
        queryClient.setQueryData(queryKeys.tournees.detail(tourneeId), context.previousTournee);
      }
      toast.error((error as Error).message || 'Erreur');
    },
    onSuccess: () => {
      toast.success('Point supprimé');
    },
    onSettled: (_, __, { tourneeId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tournees.detail(tourneeId) });
    },
  });
}

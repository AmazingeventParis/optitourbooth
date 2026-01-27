import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { produitsService } from '@/services/produits.service';
import { queryKeys } from './queryKeys';
import { Produit, PaginationMeta } from '@/types';
import toast from 'react-hot-toast';

// Types
interface ProduitsFilters {
  page?: number;
  limit?: number;
  actif?: boolean;
  search?: string;
}

// ============================================
// QUERIES
// ============================================

/**
 * Hook pour récupérer la liste des produits
 */
export function useProduits(filters: ProduitsFilters = {}) {
  return useQuery({
    queryKey: queryKeys.produits.list(filters as Record<string, unknown>),
    queryFn: () => produitsService.list(filters),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook pour récupérer un produit par ID
 */
export function useProduit(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.produits.detail(id!),
    queryFn: () => produitsService.getById(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook pour récupérer les produits actifs (pour les selects)
 */
export function useProduitsActifs() {
  return useQuery({
    queryKey: queryKeys.produits.options(),
    queryFn: () => produitsService.listActifs(),
    staleTime: 10 * 60 * 1000, // Produits actifs changent rarement
  });
}

// ============================================
// MUTATIONS
// ============================================

interface CreateProduitInput {
  nom: string;
  reference: string;
  description?: string;
  dureeInstallation?: number;
  dureeDesinstallation?: number;
  poids?: number;
  largeur?: number;
  hauteur?: number;
  profondeur?: number;
}

/**
 * Hook pour créer un produit
 */
export function useCreateProduit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProduitInput) => produitsService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.produits.lists() });
      toast.success('Produit créé');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de la création');
    },
  });
}

/**
 * Hook pour mettre à jour un produit
 */
export function useUpdateProduit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Produit> }) =>
      produitsService.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.produits.detail(id) });

      const previous = queryClient.getQueryData<Produit>(queryKeys.produits.detail(id));

      if (previous) {
        queryClient.setQueryData<Produit>(queryKeys.produits.detail(id), {
          ...previous,
          ...data,
        });
      }

      return { previous };
    },
    onError: (error, { id }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.produits.detail(id), context.previous);
      }
      toast.error((error as Error).message || 'Erreur');
    },
    onSuccess: () => {
      toast.success('Produit mis à jour');
    },
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.produits.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.produits.lists() });
    },
  });
}

/**
 * Hook pour supprimer un produit
 */
export function useDeleteProduit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => produitsService.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.produits.lists() });

      const previousLists = queryClient.getQueriesData<{ data: Produit[]; meta: PaginationMeta }>({
        queryKey: queryKeys.produits.lists(),
      });

      queryClient.setQueriesData<{ data: Produit[]; meta: PaginationMeta }>(
        { queryKey: queryKeys.produits.lists() },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter((p) => p.id !== id),
          };
        }
      );

      return { previousLists };
    },
    onError: (error, _, context) => {
      context?.previousLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      toast.error((error as Error).message || 'Erreur');
    },
    onSuccess: () => {
      toast.success('Produit supprimé');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.produits.lists() });
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsService } from '@/services/clients.service';
import { queryKeys } from './queryKeys';
import { Client, PaginationMeta } from '@/types';
import toast from 'react-hot-toast';

// Types
interface ClientsFilters {
  page?: number;
  limit?: number;
  actif?: boolean;
  ville?: string;
  codePostal?: string;
  search?: string;
}

interface CreateClientData {
  nom: string;
  email?: string;
  telephone?: string;
  adresse: string;
  complementAdresse?: string;
  codePostal: string;
  ville: string;
  pays?: string;
  instructionsAcces?: string;
  contactNom?: string;
  contactTelephone?: string;
}

// ============================================
// QUERIES
// ============================================

/**
 * Hook pour récupérer la liste des clients avec cache
 */
export function useClients(filters: ClientsFilters = {}) {
  return useQuery({
    queryKey: queryKeys.clients.list(filters as Record<string, unknown>),
    queryFn: () => clientsService.list(filters),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook pour récupérer un client par ID
 */
export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.clients.detail(id!),
    queryFn: () => clientsService.getById(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook pour rechercher des clients (autocomplete)
 */
export function useClientSearch(search: string) {
  return useQuery({
    queryKey: ['clients', 'search', search],
    queryFn: () => clientsService.search(search),
    enabled: search.length >= 2,
    staleTime: 30 * 1000, // 30 secondes
  });
}

/**
 * Hook pour récupérer les villes disponibles
 */
export function useClientVilles() {
  return useQuery({
    queryKey: ['clients', 'villes'],
    queryFn: () => clientsService.listVilles(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

// ============================================
// MUTATIONS AVEC OPTIMISTIC UPDATES
// ============================================

/**
 * Hook pour créer un client
 */
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateClientData) => clientsService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.lists() });
      toast.success('Client créé');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de la création');
    },
  });
}

/**
 * Hook pour mettre à jour un client avec optimistic update
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Client> }) =>
      clientsService.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.clients.detail(id) });

      const previousClient = queryClient.getQueryData<Client>(
        queryKeys.clients.detail(id)
      );

      if (previousClient) {
        queryClient.setQueryData<Client>(queryKeys.clients.detail(id), {
          ...previousClient,
          ...data,
        });
      }

      return { previousClient };
    },
    onError: (error, { id }, context) => {
      if (context?.previousClient) {
        queryClient.setQueryData(queryKeys.clients.detail(id), context.previousClient);
      }
      toast.error((error as Error).message || 'Erreur lors de la mise à jour');
    },
    onSuccess: () => {
      toast.success('Client mis à jour');
    },
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.lists() });
    },
  });
}

/**
 * Hook pour supprimer un client avec optimistic update
 */
export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => clientsService.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.clients.lists() });

      const previousLists = queryClient.getQueriesData<{ data: Client[]; meta: PaginationMeta }>({
        queryKey: queryKeys.clients.lists(),
      });

      queryClient.setQueriesData<{ data: Client[]; meta: PaginationMeta }>(
        { queryKey: queryKeys.clients.lists() },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter((c) => c.id !== id),
            meta: { ...old.meta, total: old.meta.total - 1 },
          };
        }
      );

      return { previousLists };
    },
    onError: (error, _, context) => {
      context?.previousLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      toast.error((error as Error).message || 'Erreur lors de la suppression');
    },
    onSuccess: () => {
      toast.success('Client supprimé');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.lists() });
    },
  });
}

/**
 * Hook pour géocoder un client
 */
export function useGeocodeClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => clientsService.geocode(id),
    onSuccess: (data, id) => {
      // Mettre à jour le client dans le cache avec les nouvelles coordonnées
      queryClient.setQueryData<Client>(queryKeys.clients.detail(id), data);
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.lists() });
      toast.success('Adresse géocodée');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors du géocodage');
    },
  });
}

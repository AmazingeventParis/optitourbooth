import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersService } from '@/services/users.service';
import { queryKeys } from './queryKeys';
import { User, PaginationMeta } from '@/types';
import toast from 'react-hot-toast';

// Types
interface UsersFilters {
  page?: number;
  limit?: number;
  role?: 'admin' | 'chauffeur';
  actif?: boolean;
}

// ============================================
// QUERIES
// ============================================

/**
 * Hook pour récupérer la liste des utilisateurs
 */
export function useUsers(filters: UsersFilters = {}) {
  return useQuery({
    queryKey: queryKeys.users.list(filters as Record<string, unknown>),
    queryFn: () => usersService.list(filters),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook pour récupérer un utilisateur par ID
 */
export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.users.detail(id!),
    queryFn: () => usersService.getById(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook pour récupérer la liste des chauffeurs actifs
 * Utilisé fréquemment pour les selects, donc cache plus long
 */
export function useChauffeurs() {
  return useQuery({
    queryKey: queryKeys.users.chauffeurs(),
    queryFn: () => usersService.listChauffeurs(),
    staleTime: 10 * 60 * 1000, // 10 minutes - chauffeurs changent rarement
  });
}

// ============================================
// MUTATIONS
// ============================================

interface CreateUserInput {
  email: string;
  password: string;
  nom: string;
  prenom: string;
  role: 'admin' | 'chauffeur';
  telephone?: string;
}

/**
 * Hook pour créer un utilisateur
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserInput) => usersService.create(data),
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
      // Si c'est un chauffeur, invalider aussi la liste des chauffeurs
      if (newUser.role === 'chauffeur') {
        queryClient.invalidateQueries({ queryKey: queryKeys.users.chauffeurs() });
      }
      toast.success('Utilisateur créé');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur lors de la création');
    },
  });
}

/**
 * Hook pour mettre à jour un utilisateur
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<User> }) =>
      usersService.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users.detail(id) });

      const previous = queryClient.getQueryData<User>(queryKeys.users.detail(id));

      if (previous) {
        queryClient.setQueryData<User>(queryKeys.users.detail(id), {
          ...previous,
          ...data,
        });
      }

      return { previous };
    },
    onError: (error, { id }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.users.detail(id), context.previous);
      }
      toast.error((error as Error).message || 'Erreur');
    },
    onSuccess: (updatedUser) => {
      // Invalider la liste des chauffeurs si le rôle a changé
      if (updatedUser.role === 'chauffeur') {
        queryClient.invalidateQueries({ queryKey: queryKeys.users.chauffeurs() });
      }
      toast.success('Utilisateur mis à jour');
    },
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}

/**
 * Hook pour supprimer un utilisateur
 */
export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => usersService.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users.lists() });

      const previousLists = queryClient.getQueriesData<{ data: User[]; meta: PaginationMeta }>({
        queryKey: queryKeys.users.lists(),
      });

      queryClient.setQueriesData<{ data: User[]; meta: PaginationMeta }>(
        { queryKey: queryKeys.users.lists() },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter((u) => u.id !== id),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.users.chauffeurs() });
      toast.success('Utilisateur supprimé');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() });
    },
  });
}

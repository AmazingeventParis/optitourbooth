import { memo, useCallback } from 'react';
import { Link, LinkProps, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { tourneesService } from '@/services/tournees.service';
import { clientsService } from '@/services/clients.service';

// Configuration du prefetch par route
type PrefetchConfig = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  staleTime?: number;
};

// Map des prefetch par pattern de route
const prefetchConfigs: Record<string, (params?: Record<string, string>) => PrefetchConfig[]> = {
  '/tournees': () => [
    {
      queryKey: queryKeys.tournees.list({}),
      queryFn: () => tourneesService.list({ page: 1, limit: 20 }),
      staleTime: 60 * 1000,
    },
  ],
  '/tournees/:id': (params) => params?.id ? [
    {
      queryKey: queryKeys.tournees.detail(params.id),
      queryFn: () => tourneesService.getById(params.id),
      staleTime: 2 * 60 * 1000,
    },
  ] : [],
  '/clients': () => [
    {
      queryKey: queryKeys.clients.list({}),
      queryFn: () => clientsService.list({ page: 1, limit: 20 }),
      staleTime: 60 * 1000,
    },
  ],
};

// Extraire les paramètres d'une URL
function extractParams(path: string, pattern: string): Record<string, string> | null {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  if (pathParts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

// Hook pour prefetch des données
function usePrefetch() {
  const queryClient = useQueryClient();

  return useCallback((path: string) => {
    // Trouver la config qui match
    for (const [pattern, getConfigs] of Object.entries(prefetchConfigs)) {
      const params = extractParams(path, pattern);
      if (params !== null) {
        const configs = getConfigs(params);
        for (const config of configs) {
          // Prefetch si les données sont stale ou absentes
          queryClient.prefetchQuery({
            queryKey: config.queryKey,
            queryFn: config.queryFn,
            staleTime: config.staleTime || 60 * 1000,
          });
        }
        break;
      }
    }
  }, [queryClient]);
}

interface PrefetchLinkProps extends LinkProps {
  prefetch?: boolean;
  prefetchDelay?: number; // Délai avant prefetch en ms
}

/**
 * Link avec prefetch automatique au hover
 *
 * Usage:
 * <PrefetchLink to="/tournees/123">Voir tournée</PrefetchLink>
 */
export const PrefetchLink = memo(function PrefetchLink({
  children,
  to,
  prefetch = true,
  prefetchDelay = 100,
  onMouseEnter,
  onFocus,
  ...props
}: PrefetchLinkProps) {
  const doPrefetch = usePrefetch();

  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (prefetch && typeof to === 'string') {
      // Petit délai pour éviter de prefetch sur un passage rapide
      const timeout = setTimeout(() => {
        doPrefetch(to);
      }, prefetchDelay);

      // Cleanup si la souris quitte avant le délai
      const target = e.currentTarget;
      const cleanup = () => {
        clearTimeout(timeout);
        target.removeEventListener('mouseleave', cleanup);
      };
      target.addEventListener('mouseleave', cleanup);
    }
    onMouseEnter?.(e);
  }, [prefetch, to, prefetchDelay, doPrefetch, onMouseEnter]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLAnchorElement>) => {
    if (prefetch && typeof to === 'string') {
      doPrefetch(to);
    }
    onFocus?.(e);
  }, [prefetch, to, doPrefetch, onFocus]);

  return (
    <Link
      to={to}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
      {...props}
    >
      {children}
    </Link>
  );
});

/**
 * Hook pour prefetch programmatique
 *
 * Usage:
 * const { prefetch, prefetchAndNavigate } = usePrefetchNavigation();
 * prefetch('/tournees/123');
 * prefetchAndNavigate('/tournees/123');
 */
export function usePrefetchNavigation() {
  const doPrefetch = usePrefetch();
  const navigate = useNavigate();

  const prefetchAndNavigate = useCallback((path: string) => {
    doPrefetch(path);
    navigate(path);
  }, [doPrefetch, navigate]);

  return {
    prefetch: doPrefetch,
    prefetchAndNavigate,
  };
}

export default PrefetchLink;

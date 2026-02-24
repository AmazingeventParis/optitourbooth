import { memo } from 'react';

interface PageLoaderProps {
  message?: string;
}

/**
 * Composant de chargement pour les pages lazy-loadées
 * Utilisé avec React.Suspense
 */
function PageLoaderInner({ message = 'Chargement...' }: PageLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="relative">
        {/* Spinner principal */}
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-200 border-t-primary-600" />
        {/* Effet de pulsation */}
        <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 border-2 border-primary-400 opacity-20" />
      </div>
      <p className="text-gray-500 text-sm animate-pulse">{message}</p>
    </div>
  );
}

export const PageLoader = memo(PageLoaderInner);

/**
 * Squelette de chargement pour les cartes
 */
export const CardSkeleton = memo(function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-4" />
      <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-2/3" />
    </div>
  );
});

/**
 * Squelette de chargement pour les tables
 */
export const TableSkeleton = memo(function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
      {/* Header */}
      <div className="bg-gray-50 px-6 py-3 flex gap-4">
        <div className="h-3 bg-gray-200 rounded w-24" />
        <div className="h-3 bg-gray-200 rounded w-32" />
        <div className="h-3 bg-gray-200 rounded w-20" />
        <div className="h-3 bg-gray-200 rounded w-28" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-6 py-4 flex gap-4 border-t border-gray-200">
          <div className="h-4 bg-gray-200 rounded w-24" />
          <div className="h-4 bg-gray-200 rounded w-32" />
          <div className="h-4 bg-gray-200 rounded w-20" />
          <div className="h-4 bg-gray-200 rounded w-28" />
        </div>
      ))}
    </div>
  );
});

/**
 * Squelette pour les statistiques du dashboard
 */
export const StatsSkeleton = memo(function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 bg-gray-200 rounded-full" />
            <div className="flex-1">
              <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
              <div className="h-6 bg-gray-200 rounded w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

/**
 * Skeleton pour le dashboard chauffeur
 */
export const DashboardSkeleton = memo(function DashboardSkeleton() {
  return (
    <div className="p-4 space-y-6 animate-pulse">
      {/* Greeting */}
      <div>
        <div className="h-7 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-36" />
      </div>
      {/* Tournee card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="h-5 bg-gray-200 rounded w-36 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-28" />
          </div>
          <div className="h-6 bg-gray-200 rounded-full w-20" />
        </div>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-lg p-3 text-center">
              <div className="h-8 bg-gray-200 rounded w-8 mx-auto mb-1" />
              <div className="h-3 bg-gray-200 rounded w-12 mx-auto" />
            </div>
          ))}
        </div>
        <div className="h-10 bg-gray-200 rounded-lg w-full" />
      </div>
      {/* Weekly stats */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-xl p-3 text-center">
              <div className="h-8 bg-gray-200 rounded w-12 mx-auto mb-1" />
              <div className="h-3 bg-gray-200 rounded w-16 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * Skeleton pour la liste de tournée chauffeur
 */
export const TourneeListSkeleton = memo(function TourneeListSkeleton() {
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-pulse">
      {/* Header */}
      <div className="p-4 bg-white border-b">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="h-6 bg-gray-200 rounded w-40 mb-2" />
            <div className="h-4 bg-gray-200 rounded w-28" />
          </div>
          <div className="h-9 bg-gray-200 rounded-lg w-24" />
        </div>
        <div className="h-10 bg-gray-100 rounded-lg" />
      </div>
      {/* List items */}
      <div className="flex-1 p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full" />
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="h-4 bg-gray-200 rounded w-32" />
                  <div className="h-5 bg-gray-200 rounded-full w-16" />
                </div>
                <div className="h-3 bg-gray-200 rounded w-48 mb-2" />
                <div className="flex items-center gap-3">
                  <div className="h-5 bg-gray-200 rounded w-20" />
                  <div className="h-3 bg-gray-200 rounded w-16" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * Skeleton pour le détail d'un point chauffeur
 */
export const PointDetailSkeleton = memo(function PointDetailSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 bg-gray-200 rounded" />
        <div className="flex-1">
          <div className="h-5 bg-gray-200 rounded w-24 mb-1" />
          <div className="h-5 bg-gray-200 rounded w-20" />
        </div>
        <div className="h-6 bg-gray-200 rounded-full w-16" />
      </div>
      {/* Client info */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="h-5 bg-gray-200 rounded w-40 mb-3" />
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-5 w-5 bg-gray-200 rounded" />
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-48 mb-1" />
              <div className="h-3 bg-gray-200 rounded w-32" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 bg-gray-200 rounded" />
            <div className="h-4 bg-gray-200 rounded w-28" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <div className="h-10 bg-gray-200 rounded-lg flex-1" />
          <div className="h-10 bg-gray-200 rounded-lg flex-1" />
        </div>
      </div>
      {/* Photos grid */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="h-5 bg-gray-200 rounded w-24 mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-200 rounded" />
          ))}
        </div>
      </div>
      {/* Action buttons */}
      <div className="space-y-3">
        <div className="h-11 bg-gray-200 rounded-lg" />
        <div className="h-11 bg-gray-200 rounded-lg" />
        <div className="h-11 bg-gray-200 rounded-lg" />
      </div>
    </div>
  );
});

/**
 * Skeleton pour l'agenda chauffeur
 */
export const AgendaSkeleton = memo(function AgendaSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-7 bg-gray-200 rounded w-36" />
        <div className="h-4 bg-gray-200 rounded w-20" />
      </div>
      {/* Calendar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="h-8 w-8 bg-gray-200 rounded" />
          <div className="h-5 bg-gray-200 rounded w-32" />
          <div className="h-8 w-8 bg-gray-200 rounded" />
        </div>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 rounded mx-auto w-8" />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
});

export default PageLoader;

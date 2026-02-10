import { memo, useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { clsx } from 'clsx';
import { ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon } from '@heroicons/react/24/outline';
import Button from './Button';

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
  width?: number; // Largeur en pixels pour la virtualisation
  sortable?: boolean; // Activer le tri sur cette colonne
  sortValue?: (item: T) => string | number | null; // Extraire la valeur de tri
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  // Options de virtualisation
  virtualize?: boolean; // Forcer la virtualisation
  virtualizeThreshold?: number; // Seuil pour activer automatiquement (défaut: 50)
  rowHeight?: number; // Hauteur de ligne (défaut: 56)
  maxHeight?: number; // Hauteur max de la table virtualisée (défaut: 600)
}

// Seuil par défaut pour activer la virtualisation
const DEFAULT_VIRTUALIZE_THRESHOLD = 50;
const DEFAULT_ROW_HEIGHT = 56;
const DEFAULT_MAX_HEIGHT = 600;

// Composant de ligne mémorisé pour la table standard
const TableRow = memo(function TableRow<T>({
  item,
  columns,
  onRowClick,
}: {
  item: T;
  columns: Column<T>[];
  onRowClick?: (item: T) => void;
}) {
  const handleClick = useCallback(() => {
    onRowClick?.(item);
  }, [item, onRowClick]);

  return (
    <tr
      onClick={handleClick}
      className={clsx(
        onRowClick && 'cursor-pointer hover:bg-gray-50'
      )}
    >
      {columns.map((column) => (
        <td
          key={column.key}
          className={clsx(
            'px-6 py-4 whitespace-nowrap text-sm text-gray-900',
            column.className
          )}
        >
          {column.render
            ? column.render(item)
            : (item as Record<string, unknown>)[column.key] as React.ReactNode}
        </td>
      ))}
    </tr>
  );
}) as <T>(props: {
  item: T;
  columns: Column<T>[];
  onRowClick?: (item: T) => void;
}) => React.ReactElement;

// Interface pour les données du contexte de virtualisation
interface VirtualListItemData<T> {
  items: T[];
  columns: Column<T>[];
  onRowClick?: (item: T) => void;
}

// Composant de ligne virtualisée
function VirtualRow<T>({ data, index, style }: ListChildComponentProps<VirtualListItemData<T>>) {
  const { items, columns, onRowClick } = data;
  const item = items[index];

  const handleClick = useCallback(() => {
    if (onRowClick && item) {
      onRowClick(item);
    }
  }, [item, onRowClick]);

  if (!item) return null;

  return (
    <div
      style={style}
      onClick={handleClick}
      className={clsx(
        'flex items-center border-b border-gray-200 bg-white',
        onRowClick && 'cursor-pointer hover:bg-gray-50'
      )}
    >
      {columns.map((column) => (
        <div
          key={column.key}
          style={{ width: column.width || 'auto', flex: column.width ? 'none' : 1 }}
          className={clsx(
            'px-6 py-4 whitespace-nowrap text-sm text-gray-900 truncate',
            column.className
          )}
        >
          {column.render
            ? column.render(item)
            : (item as Record<string, unknown>)[column.key] as React.ReactNode}
        </div>
      ))}
    </div>
  );
}

const MemoizedVirtualRow = memo(VirtualRow) as typeof VirtualRow;

type SortDirection = 'asc' | 'desc' | null;

function DataTableInner<T>({
  columns,
  data,
  keyExtractor,
  isLoading,
  emptyMessage = 'Aucune donnée',
  onRowClick,
  pagination,
  virtualize,
  virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
  rowHeight = DEFAULT_ROW_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
}: DataTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const handleSort = useCallback((columnKey: string) => {
    if (sortKey === columnKey) {
      // Cycle: asc -> desc -> none
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') { setSortKey(null); setSortDirection(null); }
    } else {
      setSortKey(columnKey);
      setSortDirection('asc');
    }
  }, [sortKey, sortDirection]);

  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortable) return data;

    const getValue = col.sortValue || ((item: T) => {
      const val = (item as Record<string, unknown>)[col.key];
      return val as string | number | null;
    });

    return [...data].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = typeof aVal === 'string' && typeof bVal === 'string'
        ? aVal.localeCompare(bVal, 'fr')
        : (aVal as number) - (bVal as number);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDirection, columns]);

  // Déterminer si on doit virtualiser
  const shouldVirtualize = useMemo(() => {
    if (virtualize !== undefined) return virtualize;
    return data.length > virtualizeThreshold;
  }, [virtualize, data.length, virtualizeThreshold]);

  // Observer la largeur du conteneur pour la virtualisation
  useEffect(() => {
    if (!shouldVirtualize || !containerRef.current) return;

    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [shouldVirtualize]);

  // Mémoisation du calcul des pages totales
  const totalPages = useMemo(() =>
    pagination ? Math.ceil(pagination.total / pagination.limit) : 0,
    [pagination?.total, pagination?.limit]
  );

  // Callbacks mémorisés pour la pagination
  const handlePrevPage = useCallback(() => {
    pagination?.onPageChange(pagination.page - 1);
  }, [pagination]);

  const handleNextPage = useCallback(() => {
    pagination?.onPageChange(pagination.page + 1);
  }, [pagination]);

  // Données pour la liste virtualisée
  const itemData = useMemo<VirtualListItemData<T>>(() => ({
    items: sortedData,
    columns,
    onRowClick,
  }), [sortedData, columns, onRowClick]);

  // Calculer la hauteur de la liste
  const listHeight = useMemo(() => {
    const contentHeight = sortedData.length * rowHeight;
    return Math.min(contentHeight, maxHeight);
  }, [sortedData.length, rowHeight, maxHeight]);

  const renderSortIcon = (columnKey: string) => {
    if (sortKey !== columnKey) return <ChevronUpDownIcon className="h-4 w-4 text-gray-400" />;
    if (sortDirection === 'asc') return <ChevronUpIcon className="h-4 w-4 text-primary-600" />;
    return <ChevronDownIcon className="h-4 w-4 text-primary-600" />;
  };

  // Rendu de la table standard (non virtualisée)
  const renderStandardTable = () => (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={clsx(
                  'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider',
                  column.sortable && 'cursor-pointer select-none hover:text-gray-700',
                  column.className
                )}
                onClick={column.sortable ? () => handleSort(column.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {column.header}
                  {column.sortable && renderSortIcon(column.key)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {isLoading ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-6 py-12 text-center"
              >
                <div className="flex justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                </div>
              </td>
            </tr>
          ) : sortedData.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-6 py-12 text-center text-gray-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((item) => (
              <TableRow
                key={keyExtractor(item)}
                item={item}
                columns={columns}
                onRowClick={onRowClick}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  // Rendu de la table virtualisée
  const renderVirtualizedTable = () => (
    <div ref={containerRef} className="rounded-lg border border-gray-200 overflow-hidden">
      {/* Header fixe */}
      <div className="flex bg-gray-50 border-b border-gray-200">
        {columns.map((column) => (
          <div
            key={column.key}
            style={{ width: column.width || 'auto', flex: column.width ? 'none' : 1 }}
            className={clsx(
              'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider',
              column.sortable && 'cursor-pointer select-none hover:text-gray-700',
              column.className
            )}
            onClick={column.sortable ? () => handleSort(column.key) : undefined}
          >
            <span className="inline-flex items-center gap-1">
              {column.header}
              {column.sortable && renderSortIcon(column.key)}
            </span>
          </div>
        ))}
      </div>

      {/* Corps virtualisé */}
      {isLoading ? (
        <div className="px-6 py-12 text-center bg-white">
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        </div>
      ) : sortedData.length === 0 ? (
        <div className="px-6 py-12 text-center text-gray-500 bg-white">
          {emptyMessage}
        </div>
      ) : (
        <List
          height={listHeight}
          itemCount={sortedData.length}
          itemSize={rowHeight}
          width={containerWidth || '100%'}
          itemData={itemData}
          overscanCount={5}
          className="bg-white"
        >
          {MemoizedVirtualRow as React.ComponentType<ListChildComponentProps<VirtualListItemData<T>>>}
        </List>
      )}
    </div>
  );

  return (
    <div className="w-full">
      {shouldVirtualize ? renderVirtualizedTable() : renderStandardTable()}

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-2">
          <p className="text-sm text-gray-500">
            Affichage de{' '}
            <span className="font-medium">
              {(pagination.page - 1) * pagination.limit + 1}
            </span>{' '}
            à{' '}
            <span className="font-medium">
              {Math.min(pagination.page * pagination.limit, pagination.total)}
            </span>{' '}
            sur <span className="font-medium">{pagination.total}</span> résultats
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1}
              onClick={handlePrevPage}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-700">
              Page {pagination.page} sur {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= totalPages}
              onClick={handleNextPage}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Export avec memo pour éviter les re-renders inutiles
const DataTable = memo(DataTableInner) as typeof DataTableInner;
export default DataTable;

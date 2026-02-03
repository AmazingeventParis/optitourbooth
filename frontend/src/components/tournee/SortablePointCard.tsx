import { memo, useMemo, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Point, Client, PointProduit, Produit } from '@/types';
import { Badge, Button } from '@/components/ui';
import {
  Bars3Icon,
  PencilIcon,
  TrashIcon,
  ClockIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { formatTime, formatTimeRange } from '@/utils/format';

// Calcul du statut horaire basé sur l'ETA vs le créneau
export type TimeStatus = 'early' | 'ontime' | 'late' | 'unknown';

const TIME_STATUS_CONFIGS = {
  early: {
    bg: 'bg-blue-100',
    border: 'border-blue-300',
    text: 'text-blue-700',
    badgeBg: 'bg-blue-500',
    label: 'En avance'
  },
  ontime: {
    bg: 'bg-green-100',
    border: 'border-green-300',
    text: 'text-green-700',
    badgeBg: 'bg-green-500',
    label: 'À l\'heure'
  },
  late: {
    bg: 'bg-red-100',
    border: 'border-red-300',
    text: 'text-red-700',
    badgeBg: 'bg-red-500',
    label: 'En retard'
  },
  unknown: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-500',
    badgeBg: 'bg-primary-500',
    label: ''
  },
} as const;

/**
 * Convertit une heure (string ou ISO) en minutes depuis minuit
 */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;

  let hours: number;
  let minutes: number;

  // Format ISO (1970-01-01T08:00:00.000Z ou 2026-01-26T08:00:00.000Z)
  if (time.includes('T')) {
    const date = new Date(time);
    hours = date.getUTCHours();
    minutes = date.getUTCMinutes();
  }
  // Format HH:MM ou HH:MM:SS
  else if (time.includes(':')) {
    const parts = time.split(':');
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
  } else {
    return null;
  }

  if (isNaN(hours) || isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Calcule le statut horaire basé sur l'ETA vs le créneau
 * - early (bleu): ETA avant le début du créneau
 * - ontime (vert): ETA dans le créneau
 * - late (rouge): ETA après la fin du créneau
 */
export function getTimeStatus(
  heureArriveeEstimee: string | null | undefined,
  creneauDebut: string | null | undefined,
  creneauFin: string | null | undefined
): TimeStatus {
  const etaMinutes = timeToMinutes(heureArriveeEstimee);

  // Pas d'ETA = inconnu
  if (etaMinutes === null) return 'unknown';

  const debutMinutes = timeToMinutes(creneauDebut);
  const finMinutes = timeToMinutes(creneauFin);

  // Si pas de créneau défini, on considère comme à l'heure
  if (debutMinutes === null && finMinutes === null) return 'ontime';

  // En avance: ETA avant le début du créneau
  if (debutMinutes !== null && etaMinutes < debutMinutes) return 'early';

  // En retard: ETA après la fin du créneau
  if (finMinutes !== null && etaMinutes > finMinutes) return 'late';

  // Sinon: à l'heure (dans le créneau)
  return 'ontime';
}

// Configs statiques déplacées hors du composant pour éviter les recréations
const TYPE_CONFIGS = {
  livraison: { label: 'Livraison', color: 'bg-blue-100 text-blue-800' },
  ramassage: { label: 'Ramassage', color: 'bg-purple-100 text-purple-800' },
  livraison_ramassage: { label: 'Liv. + Ram.', color: 'bg-indigo-100 text-indigo-800' },
} as const;

const STATUT_CONFIGS = {
  a_faire: { variant: 'default' as const, label: 'À faire' },
  en_cours: { variant: 'warning' as const, label: 'En cours' },
  termine: { variant: 'success' as const, label: 'Terminé' },
  incident: { variant: 'danger' as const, label: 'Incident' },
  annule: { variant: 'default' as const, label: 'Annulé' },
} as const;

// Couleur par défaut si aucun produit
const DEFAULT_PRODUCT_COLOR = '#6366F1'; // Indigo

/**
 * Récupère la couleur du premier produit du point
 */
const getProductColor = (point: Point): string => {
  const produits = point.produits as PointProduit[] | undefined;
  const firstProduct = produits?.[0]?.produit as Produit | undefined;
  return firstProduct?.couleur || DEFAULT_PRODUCT_COLOR;
};

interface SortablePointCardProps {
  point: Point;
  index: number;
  isSelected: boolean;
  canDrag: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const getTypeConfig = (type: string) => {
  return TYPE_CONFIGS[type as keyof typeof TYPE_CONFIGS] || TYPE_CONFIGS.livraison;
};

const getStatutConfig = (statut: string) => {
  return STATUT_CONFIGS[statut as keyof typeof STATUT_CONFIGS] || STATUT_CONFIGS.a_faire;
};

const SortablePointCard = memo(function SortablePointCard({
  point,
  index,
  isSelected,
  canDrag,
  onClick,
  onEdit,
  onDelete,
}: SortablePointCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: point.id, disabled: !canDrag });

  const style = useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
  }), [transform, transition]);

  const client = point.client as Client | undefined;

  // Mémoisation des configs pour éviter les recalculs
  const typeConfig = useMemo(() => getTypeConfig(point.type), [point.type]);
  const statutConfig = useMemo(() => getStatutConfig(point.statut), [point.statut]);

  // Calcul du statut horaire (ETA vs créneau)
  const timeStatus = useMemo(
    () => getTimeStatus(point.heureArriveeEstimee, point.creneauDebut, point.creneauFin),
    [point.heureArriveeEstimee, point.creneauDebut, point.creneauFin]
  );
  const timeStatusConfig = TIME_STATUS_CONFIGS[timeStatus];

  // Couleur du produit pour la pastille
  const productColor = useMemo(() => getProductColor(point), [point.produits]);

  // Mémoisation des handlers pour éviter les re-renders enfants
  const handleEditClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit();
  }, [onEdit]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  }, [onDelete]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'border rounded-lg p-3 transition-all cursor-pointer',
        isDragging && 'opacity-50 shadow-lg',
        isSelected && 'ring-2 ring-primary-500 border-primary-500',
        !isSelected && 'hover:border-gray-400',
        // Couleur de fond basée sur le statut horaire
        timeStatus !== 'unknown' ? timeStatusConfig.bg : 'bg-white',
        timeStatus !== 'unknown' && !isSelected && timeStatusConfig.border
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Drag Handle & Number */}
        <div className="flex items-center gap-2">
          {canDrag && (
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-100"
            >
              <Bars3Icon className="h-5 w-5 text-gray-400" />
            </div>
          )}
          <div
            className="flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm text-white"
            style={{ backgroundColor: productColor }}
          >
            {index + 1}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium truncate">{client?.nom || 'Client inconnu'}</span>
            <span className={clsx('px-2 py-0.5 text-xs font-medium rounded', typeConfig.color)}>
              {typeConfig.label}
            </span>
            <Badge variant={statutConfig.variant} size="sm">
              {statutConfig.label}
            </Badge>
          </div>

          <div className="text-sm text-gray-500 space-y-1">
            <div className="flex items-center">
              <MapPinIcon className="h-4 w-4 mr-1 flex-shrink-0" />
              <span className="truncate">
                {client?.adresse}, {client?.codePostal} {client?.ville}
              </span>
            </div>

            <div className="flex items-center gap-4">
              {(point.creneauDebut || point.creneauFin) && (
                <span className="flex items-center">
                  <ClockIcon className="h-4 w-4 mr-1" />
                  {formatTimeRange(point.creneauDebut, point.creneauFin)}
                </span>
              )}
              {point.heureArriveeEstimee && (
                <span className={clsx(
                  'flex items-center font-medium',
                  timeStatusConfig.text
                )}>
                  ETA: {formatTime(point.heureArriveeEstimee)}
                </span>
              )}
              <span>{point.dureePrevue} min</span>
            </div>
          </div>

          {point.notesInternes && (
            <p className="text-sm text-gray-400 mt-1 truncate">
              {point.notesInternes}
            </p>
          )}
        </div>

        {/* Actions */}
        {canDrag && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEditClick}
            >
              <PencilIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeleteClick}
            >
              <TrashIcon className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

export default SortablePointCard;

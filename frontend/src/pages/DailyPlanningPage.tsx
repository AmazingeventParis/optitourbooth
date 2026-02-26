import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
  CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Tournee, Point, Client, PointProduit, Produit, Vehicule, PointType, ChauffeurPositionWithInfo } from '@/types';
import { tourneesService, ImportParsedPoint } from '@/services/tournees.service';
import { clientsService } from '@/services/clients.service';
import { useChauffeurs } from '@/hooks/queries/useUsers';
import { produitsService } from '@/services/produits.service';
import { socketService, ChauffeurPosition } from '@/services/socket.service';
import { useSocketStore, isPositionStale } from '@/store/socketStore';
import { useAuthStore } from '@/store/authStore';
import { Button, Badge, Modal, Input, Select, TimeSelect, AddressAutocomplete, PhoneNumbers } from '@/components/ui';
import type { AddressResult } from '@/components/ui';
import WheelTimePicker from '@/components/ui/WheelTimePicker';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import MultiTourneeMap, { PendingPointWithCoords } from '@/components/map/MultiTourneeMap';
import { useToast } from '@/hooks/useToast';
import { formatTime } from '@/utils/format';
import { TimeStatus } from '@/components/tournee/SortablePointCard';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  TruckIcon,
  MapIcon,
  WrenchScrewdriverIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  PlusIcon,
  DocumentArrowUpIcon,
  InboxStackIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  XMarkIcon,
  BoltIcon,
  TrashIcon,
  ShareIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';

// Couleurs hex pour la légende de la carte
const TOURNEE_HEX_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
];
import clsx from 'clsx';

// Couleurs ETA pour les pastilles (fond de carte = couleur produit)
const TIME_STATUS_COLORS: Record<TimeStatus, string> = {
  early: '#3B82F6',    // Bleu - en avance
  ontime: '#10B981',   // Vert - à l'heure
  late: '#EF4444',     // Rouge - en retard
  unknown: '#9CA3AF',  // Gris - pas d'info
};

// Valeurs par défaut pour le dépôt
const DEFAULT_DEPOT_ADRESSE = '3, sentier des marécages 93100 Montreuil';
const DEFAULT_HEURE_DEPART = '07:00';

// Helper pour grouper les produits avec leurs quantités (ex: "Vegas x2, Ring x3")
function groupProductsWithQuantity(products: { id: string; nom: string }[]): { id: string; nom: string; quantite: number }[] {
  const grouped = new Map<string, { id: string; nom: string; quantite: number }>();
  for (const p of products) {
    const existing = grouped.get(p.id);
    if (existing) {
      existing.quantite += 1;
    } else {
      grouped.set(p.id, { id: p.id, nom: p.nom, quantite: 1 });
    }
  }
  return Array.from(grouped.values());
}

// Formatter les produits groupés en string (ex: "Vegas x2, Ring x3")
function formatGroupedProducts(products: { id: string; nom: string }[]): string {
  const grouped = groupProductsWithQuantity(products);
  return grouped.map(p => p.quantite > 1 ? `${p.nom} x${p.quantite}` : p.nom).join(', ');
}

// Composant pour un point dans la timeline horizontale des tournées
interface TimelinePointProps {
  point: Point;
  tourneeId: string;
  timeStatus: TimeStatus;
  isOverlay?: boolean;
  isSelected?: boolean;
  onSelect?: (pointId: string) => void;
}

const TimelinePoint = memo(function TimelinePoint({ point, tourneeId, timeStatus, isOverlay, isSelected, onSelect }: TimelinePointProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: point.id,
    data: { tourneeId, point, type: 'assigned' },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const client = point.client as Client | undefined;
  const produits = point.produits as PointProduit[] | undefined;

  const typeConfig = {
    livraison: { label: 'Liv.', icon: ArrowDownTrayIcon, color: 'text-green-600 bg-green-50' },
    ramassage: { label: 'Ram.', icon: ArrowUpTrayIcon, color: 'text-blue-600 bg-blue-50' },
    livraison_ramassage: { label: 'L+R', icon: WrenchScrewdriverIcon, color: 'text-purple-600 bg-purple-50' },
  }[point.type];

  // Obtenir le premier produit
  const firstProduct = produits?.[0]?.produit as Produit | undefined;

  const handleClick = (e: React.MouseEvent) => {
    // Ne pas déclencher le clic si on est en train de glisser
    if (isDragging) return;
    e.stopPropagation();
    onSelect?.(point.id);
  };

  const productColor = firstProduct?.couleur;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: productColor ? lightenColor(productColor, 0.85) : undefined,
        borderColor: productColor || undefined,
      }}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={clsx(
        'px-2.5 py-1.5 rounded-lg border cursor-grab active:cursor-grabbing flex-shrink-0 w-[170px]',
        'hover:shadow-md transition-all duration-150',
        !productColor && 'bg-white',
        isDragging && 'opacity-50 ring-2 ring-primary-500 ring-offset-2',
        isOverlay && 'shadow-2xl ring-2 ring-primary-500 border-primary-500',
        isSelected && 'ring-2 ring-amber-400 border-amber-400'
      )}
    >
      {/* Ligne 1: numéro + client + type */}
      <div className="flex items-center gap-1.5">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ backgroundColor: TIME_STATUS_COLORS[timeStatus] }}
        >
          {point.ordre + 1}
        </div>
        <div className="font-medium text-xs truncate flex-1">
          {client?.nom || 'Client inconnu'}
        </div>
        <div className={clsx(
          'flex items-center font-medium px-1 py-0.5 rounded flex-shrink-0',
          typeConfig.color
        )}>
          <typeConfig.icon className="h-3.5 w-3.5" />
        </div>
      </div>
      {/* Ligne 2: produit + créneau */}
      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-600">
        {firstProduct && (
          <span className="truncate flex-1">{firstProduct.nom}</span>
        )}
        {point.creneauDebut && (
          <span className="flex-shrink-0 text-gray-500">
            {formatTime(point.creneauDebut)}{point.creneauFin && `-${formatTime(point.creneauFin)}`}
          </span>
        )}
      </div>
    </div>
  );
});

// Composant pour un point en attente (horizontal)
interface PendingPointCardProps {
  point: ImportParsedPoint;
  index: number;
  isOverlay?: boolean;
  isSelected?: boolean;
  onSelect?: (index: number) => void;
}

const PendingPointCard = memo(function PendingPointCard({ point, index, isOverlay, isSelected, onSelect }: PendingPointCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `pending-${index}`,
    data: { pendingPoint: point, index, type: 'pending' },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const typeConfigs = {
    livraison: { label: 'Liv.', icon: ArrowDownTrayIcon, color: 'text-green-600 bg-green-50' },
    ramassage: { label: 'Ram.', icon: ArrowUpTrayIcon, color: 'text-blue-600 bg-blue-50' },
    livraison_ramassage: { label: 'L+R', icon: WrenchScrewdriverIcon, color: 'text-purple-600 bg-purple-50' },
  };
  const typeConfig = typeConfigs[point.type as keyof typeof typeConfigs] || typeConfigs.livraison;

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    e.stopPropagation();
    onSelect?.(index);
  };

  const productColor = point.produitCouleur;

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: productColor && !isSelected ? lightenColor(productColor, 0.85) : undefined,
        borderColor: productColor || undefined,
      }}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={clsx(
        'px-2.5 py-1.5 rounded-lg border cursor-grab active:cursor-grabbing flex-shrink-0 w-[170px]',
        'hover:shadow-md transition-all duration-150',
        !productColor && !isSelected && 'bg-white',
        isDragging && 'opacity-50 ring-2 ring-orange-500 ring-offset-2',
        isOverlay && 'shadow-2xl ring-2 ring-orange-500 border-orange-500',
        !point.clientFound && point.adresse && 'border-blue-300 bg-blue-50',
        isSelected && 'ring-2 ring-amber-400 border-amber-400 bg-amber-50'
      )}
    >
      {/* Ligne 1: numéro + client + type */}
      <div className="flex items-center gap-1.5">
        <div className={clsx(
          'w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
          'bg-orange-500'
        )}>
          {index + 1}
        </div>
        <div className="font-medium text-xs truncate flex-1">
          {point.clientName}
        </div>
        <div className={clsx(
          'flex items-center font-medium px-1 py-0.5 rounded flex-shrink-0',
          typeConfig.color
        )}>
          <typeConfig.icon className="h-3.5 w-3.5" />
        </div>
        {!point.clientFound && point.adresse && (
          <PlusIcon className="h-4 w-4 text-blue-500 flex-shrink-0" />
        )}
      </div>
      {/* Ligne 2: produit + créneau */}
      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-500">
        {point.produitName && (
          <span className="truncate flex-1">{point.produitName}</span>
        )}
        {point.creneauDebut && (
          <span className="flex-shrink-0 text-gray-400">
            {point.creneauDebut}{point.creneauFin && `-${point.creneauFin}`}
          </span>
        )}
      </div>
    </div>
  );
});

// Composant pour la zone de dépôt des points en attente
interface PendingDropZoneProps {
  isDraggingFile: boolean;
  isImporting: boolean;
  isDraggingPoint: boolean;
  isOverPending: boolean;
  pendingPoints: ImportParsedPoint[];
  pendingPointIds: string[];
  selectedPendingIndex: number | null;
  onSelectPending: (idx: number) => void;
  onClickImport: () => void;
}

const PendingDropZone = memo(function PendingDropZone({
  isDraggingFile,
  isImporting,
  isDraggingPoint,
  isOverPending,
  pendingPoints,
  pendingPointIds,
  selectedPendingIndex,
  onSelectPending,
  onClickImport,
}: PendingDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'pending-zone',
    data: { type: 'pending-zone' },
  });

  // Utiliser isOverPending du parent OU isOver local pour la détection
  const showDropIndicator = isDraggingPoint && (isOver || isOverPending);

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'p-2 overflow-x-auto transition-all duration-150',
        showDropIndicator && 'bg-orange-200 ring-2 ring-orange-500 ring-inset shadow-inner'
      )}
    >
      {isDraggingFile ? (
        <div className="flex items-center justify-center min-h-[60px] border-2 border-dashed border-orange-400 rounded-lg bg-orange-50">
          <div className="flex items-center gap-2 text-orange-600">
            <DocumentArrowUpIcon className="h-6 w-6 animate-bounce" />
            <span className="font-semibold text-sm">Déposez votre fichier Excel ici</span>
          </div>
        </div>
      ) : isImporting ? (
        <div className="flex items-center justify-center min-h-[60px]">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500" />
          <span className="ml-2 text-sm text-orange-600">Analyse...</span>
        </div>
      ) : (
        <SortableContext items={pendingPointIds} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-2 min-h-[60px] items-center">
            {pendingPoints.length === 0 && !isDraggingPoint ? (
              <div
                className="flex-1 flex items-center justify-center text-xs text-orange-400 border-2 border-dashed border-orange-300 rounded cursor-pointer hover:border-orange-400 hover:bg-orange-100 transition-colors py-3"
                onClick={onClickImport}
              >
                <DocumentArrowUpIcon className="h-5 w-5 mr-2" />
                <span>Glissez un fichier Excel ou cliquez pour parcourir</span>
              </div>
            ) : (
              <>
                {pendingPoints.map((point, index) => (
                  <PendingPointCard
                    key={`pending-${index}`}
                    point={point}
                    index={index}
                    isSelected={selectedPendingIndex === index}
                    onSelect={onSelectPending}
                  />
                ))}
                {/* Zone de drop visible quand on glisse un point de tournée */}
                {isDraggingPoint && (
                  <div className={clsx(
                    'w-[180px] flex-shrink-0 border-2 border-dashed rounded-lg flex items-center justify-center text-xs font-medium transition-all duration-150 py-3',
                    showDropIndicator
                      ? 'border-orange-500 text-orange-700 bg-orange-100 scale-105 shadow-lg'
                      : 'border-orange-300 text-orange-400 bg-orange-50'
                  )}>
                    <ArrowUpTrayIcon className="h-4 w-4 mr-1.5" />
                    {showDropIndicator ? 'Relâchez pour retirer' : 'Retirer de la tournée'}
                  </div>
                )}
              </>
            )}
            {/* Zone vide quand on glisse et qu'il n'y a pas de points */}
            {pendingPoints.length === 0 && isDraggingPoint && (
              <div className={clsx(
                'flex-1 flex items-center justify-center text-sm border-2 border-dashed rounded-lg min-w-[200px] transition-all duration-150 py-4',
                showDropIndicator
                  ? 'border-orange-500 text-orange-700 bg-orange-100 scale-[1.02] shadow-lg'
                  : 'border-orange-300 text-orange-400 bg-orange-50'
              )}>
                <ArrowUpTrayIcon className="h-5 w-5 mr-2" />
                {showDropIndicator ? 'Relâchez pour retirer' : 'Glissez ici pour retirer de la tournée'}
              </div>
            )}
          </div>
        </SortableContext>
      )}
    </div>
  );
});

// Fonction utilitaire pour éclaircir une couleur hex
const lightenColor = (hex: string, percent: number): string => {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * percent));
  const g = Math.min(255, Math.floor(((num >> 8) & 0x00FF) + (255 - ((num >> 8) & 0x00FF)) * percent));
  const b = Math.min(255, Math.floor((num & 0x0000FF) + (255 - (num & 0x0000FF)) * percent));
  return `rgb(${r}, ${g}, ${b})`;
};

// Heures de la frise chronologique (minuit à minuit)
const TIMELINE_START_HOUR = 0;
const TIMELINE_END_HOUR = 24;
// Labels affichés toutes les 2 heures pour éviter l'encombrement
const TIMELINE_LABEL_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
// Lignes de graduation toutes les heures
const TIMELINE_GRID_HOURS = Array.from({ length: 25 }, (_, i) => i);

// === CALCUL ETA APPROXIMATIF CÔTÉ FRONTEND ===
// Vitesse moyenne estimée en km/h (prend en compte trafic urbain)
const AVERAGE_SPEED_KMH = 35;

// Calcule la distance à vol d'oiseau entre deux points (formule de Haversine)
const haversineDistance = (
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number => {
  const R = 6371; // Rayon de la Terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Parse une heure dans différents formats et retourne {hours, minutes} en HEURE LOCALE
// Formats supportés: "09:00", "9:00", "09h00", "9h00", "1970-01-01T09:00:00.000Z"
const parseTimeToHoursMinutes = (time: string | undefined): { hours: number; minutes: number } | null => {
  if (!time) return null;

  try {
    // Format ISO avec T (ex: "1970-01-01T09:00:00.000Z" ou "2026-01-28T09:00:00")
    // Toujours utiliser l'heure LOCALE pour cohérence avec l'affichage utilisateur
    if (time.includes('T')) {
      const date = new Date(time);
      if (isNaN(date.getTime())) return null;
      return {
        hours: date.getHours(),
        minutes: date.getMinutes(),
      };
    }

    // Format "09h00" ou "9h00"
    if (time.includes('h')) {
      const parts = time.split('h');
      return {
        hours: parseInt(parts[0], 10) || 0,
        minutes: parseInt(parts[1], 10) || 0,
      };
    }

    // Format "09:00" ou "9:00"
    if (time.includes(':')) {
      const parts = time.split(':');
      return {
        hours: parseInt(parts[0], 10) || 0,
        minutes: parseInt(parts[1], 10) || 0,
      };
    }

    return null;
  } catch {
    return null;
  }
};

// Calcule les ETAs approximatives pour tous les points d'une tournée
// Retourne les points avec heureArriveeEstimee calculée
// LOGIQUE MÉTIER:
// - L'arrivée peut être en avance, mais le SERVICE commence au creneauDebut (pas avant)
// - Heure de départ vers point suivant = max(heureArrivee, creneauDebut) + dureePrevue
const calculateApproximateETAs = (
  points: Point[],
  heureDepart: string | null | undefined,
  depotLat?: number | null,
  depotLon?: number | null
): Point[] => {
  if (points.length === 0) return points;

  // Parser l'heure de départ du dépôt (HEURE LOCALE)
  let currentTime: Date;
  const parsedDepart = parseTimeToHoursMinutes(heureDepart || undefined);
  if (parsedDepart) {
    currentTime = new Date();
    currentTime.setHours(parsedDepart.hours, parsedDepart.minutes, 0, 0);
  } else {
    currentTime = new Date();
    currentTime.setHours(7, 0, 0, 0); // Défaut: 7h00
  }

  // Coordonnées précédentes (dépôt ou point précédent)
  let prevLat = depotLat || null;
  let prevLon = depotLon || null;

  // Trier les points par ordre
  const sortedPoints = [...points].sort((a, b) => a.ordre - b.ordre);

  return sortedPoints.map((point) => {
    const clientLat = (point.client as Client | undefined)?.latitude;
    const clientLon = (point.client as Client | undefined)?.longitude;

    // Calculer le temps de trajet depuis le point précédent
    let travelTimeMinutes = 0;
    if (prevLat && prevLon && clientLat && clientLon) {
      const distance = haversineDistance(prevLat, prevLon, clientLat, clientLon);
      // Multiplier par 1.3 pour approximer la distance routière (pas à vol d'oiseau)
      const roadDistance = distance * 1.3;
      travelTimeMinutes = (roadDistance / AVERAGE_SPEED_KMH) * 60;
    }

    // Ajouter le temps de trajet pour obtenir l'heure d'arrivée physique
    currentTime = new Date(currentTime.getTime() + travelTimeMinutes * 60 * 1000);
    const heureArriveeEstimee = currentTime.toISOString();

    // LOGIQUE MÉTIER: Le service commence au plus tôt au creneauDebut
    // Si on arrive en avance, on ATTEND le début du créneau pour commencer
    let serviceStartTime = new Date(currentTime);

    const parsedCreneauDebut = parseTimeToHoursMinutes(point.creneauDebut);
    if (parsedCreneauDebut) {
      // Créer une date avec l'heure du créneau sur le même jour (HEURE LOCALE)
      const creneauOnSameDay = new Date(currentTime);
      creneauOnSameDay.setHours(parsedCreneauDebut.hours, parsedCreneauDebut.minutes, 0, 0);

      // Si on arrive avant le créneau, le service commence au creneauDebut
      if (currentTime < creneauOnSameDay) {
        serviceStartTime = creneauOnSameDay;
      }
    }

    // Heure de départ vers le prochain point = début du service + durée prévue (installation/désinstallation)
    const dureePrevue = point.dureePrevue || 30;
    currentTime = new Date(serviceStartTime.getTime() + dureePrevue * 60 * 1000);

    // Mettre à jour les coordonnées précédentes pour le calcul du prochain trajet
    if (clientLat && clientLon) {
      prevLat = clientLat;
      prevLon = clientLon;
    }

    return {
      ...point,
      heureArriveeEstimee,
    };
  });
};

// Convertir une heure en minutes depuis minuit pour comparaison
const timeToMinutes = (time: string | undefined): number | null => {
  if (!time) return null;

  let hours: number;
  let minutes: number;

  try {
    if (time.includes('T')) {
      const date = new Date(time);
      if (time.endsWith('Z')) {
        hours = date.getUTCHours();
        minutes = date.getUTCMinutes();
      } else {
        hours = date.getHours();
        minutes = date.getMinutes();
      }
    } else if (time.includes(':')) {
      const parts = time.split(':');
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10);
    } else {
      return null;
    }

    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
  } catch {
    return null;
  }
};

// Calcule le statut temporel basé sur heureArriveeEstimee du backend (calculé avec OSRM)
// Late = arrivée après creneauFin, Early = arrivée avant creneauDebut, Ontime = dans le créneau
const getTimeStatusFromETA = (
  heureArriveeEstimee: string | undefined,
  creneauDebut: string | undefined,
  creneauFin: string | undefined
): TimeStatus => {
  const etaMinutes = timeToMinutes(heureArriveeEstimee);
  const currentCreneauDebut = timeToMinutes(creneauDebut);
  const currentCreneauFin = timeToMinutes(creneauFin);

  // Si pas d'ETA calculée par le backend, statut inconnu
  if (etaMinutes === null) {
    return 'unknown';
  }

  // Si pas de créneau défini, considérer comme à l'heure
  if (currentCreneauDebut === null && currentCreneauFin === null) {
    return 'ontime';
  }

  // Late : arrivée APRÈS la fin du créneau
  if (currentCreneauFin !== null && etaMinutes > currentCreneauFin) {
    return 'late';
  }

  // Early : arrivée AVANT le début du créneau
  if (currentCreneauDebut !== null && etaMinutes < currentCreneauDebut) {
    return 'early';
  }

  // Ontime : arrivée dans le créneau
  return 'ontime';
};

// Formate l'ETA du backend en "HHhMM"
const formatETAFromBackend = (heureArriveeEstimee: string | undefined): string | null => {
  if (!heureArriveeEstimee) return null;
  return formatTime(heureArriveeEstimee);
};

// Convertir une heure en position sur la timeline (pourcentage)
// Gère les formats: "08:00", "08:00:00", "1970-01-01T08:00:00.000Z", "2026-01-26T13:00:00"
const getTimePosition = (time: string | undefined): number | null => {
  if (!time) return null;

  let hours: number;
  let minutes: number;

  try {
    // Format ISO avec T (ex: "1970-01-01T08:00:00.000Z" ou "2026-01-26T13:00:00")
    if (time.includes('T')) {
      const date = new Date(time);
      // Utiliser UTC pour les dates avec Z, sinon local
      if (time.endsWith('Z')) {
        hours = date.getUTCHours();
        minutes = date.getUTCMinutes();
      } else {
        hours = date.getHours();
        minutes = date.getMinutes();
      }
    }
    // Format "08:00:00" ou "08:00"
    else if (time.includes(':')) {
      const parts = time.split(':');
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10);
    } else {
      return null;
    }

    if (isNaN(hours) || isNaN(minutes)) return null;

    const totalHours = hours + minutes / 60;
    const position = ((totalHours - TIMELINE_START_HOUR) / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)) * 100;
    return Math.max(0, Math.min(100, position));
  } catch {
    return null;
  }
};

// Timeline horizontale pour une tournée avec frise chronologique
interface TourneeTimelineProps {
  tournee: Tournee;
  colorIndex: number;
  onEdit: () => void;
  onDelete?: () => void;
  onValidate?: () => void;
  selectedPointId?: string | null;
  onSelectPoint?: (pointId: string | null) => void;
  selectedDepotId?: string | null;
  onSelectDepot?: (tourneeId: string | null) => void;
  isDragging?: boolean;
  isTargeted?: boolean;
}

const TourneeTimeline = memo(function TourneeTimeline({ tournee, colorIndex, onEdit, onDelete, onValidate, selectedPointId, onSelectPoint, selectedDepotId, onSelectDepot, isDragging, isTargeted }: TourneeTimelineProps) {
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const chauffeurColor = tournee.chauffeur?.couleur || TOURNEE_HEX_COLORS[colorIndex % TOURNEE_HEX_COLORS.length];
  const points = (tournee.points || []).sort((a, b) => a.ordre - b.ordre);
  const pointIds = points.map(p => p.id);

  // Partage WhatsApp
  const shareViaWhatsApp = () => {
    const dateStr = format(new Date(tournee.date), 'EEEE d MMMM yyyy', { locale: fr });

    // En-tête du message
    let message = `*TOURNEE DU ${dateStr.toUpperCase()}*\n\n`;
    message += `> ${points.length} point(s)\n`;
    if (tournee.distanceTotaleKm) message += `> ${tournee.distanceTotaleKm.toFixed(1)} km\n`;
    message += `\n--------------------\n`;

    // Détails de chaque point
    points.forEach((point, index) => {
      const client = point.client;
      const typeLogistique = point.type === 'livraison' ? 'LIVRAISON' : point.type === 'ramassage' ? 'RECUPERATION' : 'LIVRAISON + RECUPERATION';

      // Récupérer les noms des produits (types de bornes)
      const produits = point.produits?.map((pp: PointProduit) => {
        const produit = pp.produit as Produit | undefined;
        return produit ? (pp.quantite > 1 ? `${produit.nom} x${pp.quantite}` : produit.nom) : '';
      }).filter(Boolean).join(', ') || '-';

      message += `\n*${index + 1}. ${client?.nom || 'Client'}*\n`;

      // Adresse avec lien Google Maps
      let adresseText = client?.adresse || '';
      if (client?.codePostal || client?.ville) {
        adresseText += `, ${client.codePostal || ''} ${client.ville || ''}`.trim();
      }

      // Créer les liens Maps et Waze (coordonnées si disponibles, sinon adresse)
      let mapsLink = '';
      let wazeLink = '';
      if (client?.latitude && client?.longitude) {
        mapsLink = `https://maps.google.com/?q=${client.latitude},${client.longitude}`;
        wazeLink = `https://waze.com/ul?ll=${client.latitude},${client.longitude}&navigate=yes`;
      } else if (adresseText) {
        mapsLink = `https://maps.google.com/?q=${encodeURIComponent(adresseText)}`;
        wazeLink = `https://waze.com/ul?q=${encodeURIComponent(adresseText)}`;
      }

      message += `Adresse : ${adresseText || '-'}\n`;
      if (mapsLink) {
        message += `Maps : ${mapsLink}\n`;
        message += `Waze : ${wazeLink}\n`;
      }

      // Téléphone
      const telephone = client?.telephone || client?.contactTelephone || '-';
      message += `Tel : ${telephone}\n`;

      // Créneau horaire
      if (point.creneauDebut || point.creneauFin) {
        message += `Creneau : ${point.creneauDebut ? formatTime(point.creneauDebut) : '?'} - ${point.creneauFin ? formatTime(point.creneauFin) : '?'}\n`;
      }

      // Type de borne
      message += `Borne : ${produits}\n`;

      // Type de logistique
      message += `Type : ${typeLogistique}\n`;

      // Notes
      if (point.notesInternes || point.notesClient) {
        const notes = point.notesInternes || point.notesClient;
        message += `Notes : ${notes}\n`;
      }

      message += `\n--------------------\n`;
    });

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
  };

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `tournee-${tournee.id}`,
    data: { tourneeId: tournee.id, type: 'tournee' },
  });

  const showDropIndicator = isDragging && (isOver || isTargeted);

  return (
    <div
      ref={setDroppableRef}
      className={clsx(
        'rounded-lg border-2 overflow-hidden transition-all duration-150',
        showDropIndicator && 'ring-4 ring-primary-400 shadow-xl scale-[1.01]',
        isDragging && !showDropIndicator && 'opacity-70'
      )}
      style={{
        borderColor: showDropIndicator ? '#3B82F6' : chauffeurColor,
        backgroundColor: showDropIndicator ? lightenColor('#3B82F6', 0.85) : lightenColor(chauffeurColor, 0.95)
      }}
    >
      {/* Header: Nom du livreur + infos + toggle frise */}
      <div
        className="flex items-center justify-between px-3 py-1.5 text-white"
        style={{ backgroundColor: chauffeurColor }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
            className="p-0.5 rounded hover:bg-white/20 transition-colors"
            title={isTimelineExpanded ? "Masquer la frise" : "Afficher la frise chronologique"}
          >
            {isTimelineExpanded ? (
              <ChevronUpIcon className="h-4 w-4" />
            ) : (
              <ChevronDownIcon className="h-4 w-4" />
            )}
          </button>
          <span className="font-semibold text-sm">
            {tournee.chauffeur?.prenom} {tournee.chauffeur?.nom}
          </span>
          <span className="text-xs opacity-80">
            ({points.length} pt{points.length > 1 ? 's' : ''})
          </span>
          {/* Infos tournée: horaires, distance, durée */}
          <span className="text-xs opacity-80 hidden sm:inline-flex items-center gap-2 ml-2 border-l border-white/30 pl-2">
            {/* Horaires: départ → fin */}
            {(tournee.heureDepart || tournee.heureFinEstimee) && (
              <span>
                {tournee.heureDepart ? formatTime(tournee.heureDepart) : '?'}
                {' → '}
                {tournee.heureFinEstimee ? formatTime(tournee.heureFinEstimee) : '?'}
              </span>
            )}
            {tournee.distanceTotaleKm != null && (
              <span>{tournee.distanceTotaleKm.toFixed(1)} km</span>
            )}
            {/* Consommation carburant estimée */}
            {tournee.distanceTotaleKm != null && tournee.vehicule?.consommationL100km && (
              <span title={`${tournee.vehicule.nom || 'Véhicule'} - ${tournee.vehicule.consommationL100km} L/100km`}>
                ⛽ {((tournee.distanceTotaleKm * tournee.vehicule.consommationL100km) / 100).toFixed(1)} L
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {tournee.statut === 'brouillon' && (
            <span className="text-[10px] opacity-70 bg-white/10 px-1.5 py-0.5 rounded">Brouillon</span>
          )}
          <div className="flex items-center gap-0.5">
            <button
              onClick={shareViaWhatsApp}
              className="p-1 rounded hover:bg-white/20 transition-colors"
              title="Partager via WhatsApp"
            >
              <ShareIcon className="h-4 w-4" />
            </button>
            <button
              onClick={onEdit}
              className="p-1 rounded hover:bg-white/20 transition-colors"
              title="Modifier la tournée"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
            {onDelete && tournee.statut !== 'en_cours' && tournee.statut !== 'terminee' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="p-1 rounded bg-red-500/50 hover:bg-red-500/80 transition-colors"
                title="Supprimer la tournée"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
            {tournee.statut === 'brouillon' && onValidate && (
              <button
                onClick={onValidate}
                className="p-1 rounded bg-green-500/80 hover:bg-green-500 transition-colors"
                title="Valider la tournée pour la rendre visible au livreur"
              >
                <CheckIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Frise chronologique (masquée par défaut) */}
      {isTimelineExpanded && (
        <div className="px-3 pt-2 pb-1 border-b border-gray-200">
          {/* Graduation des heures (labels toutes les 2h) */}
          <div className="relative h-5 mb-1">
            {TIMELINE_LABEL_HOURS.map((hour) => {
              const position = ((hour - TIMELINE_START_HOUR) / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)) * 100;
              return (
                <div
                  key={hour}
                  className="absolute text-[10px] text-gray-400 -translate-x-1/2"
                  style={{ left: `${position}%` }}
                >
                  {hour}h
                </div>
              );
            })}
          </div>

          {/* Barre de timeline avec les points */}
          <div className="relative h-10 bg-gray-100 rounded-lg overflow-visible">
            {/* Lignes de graduation (toutes les heures) */}
            {TIMELINE_GRID_HOURS.map((hour) => {
              const position = ((hour - TIMELINE_START_HOUR) / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)) * 100;
              return (
                <div
                  key={hour}
                  className="absolute top-0 bottom-0 w-px bg-gray-200"
                  style={{ left: `${position}%` }}
                />
              );
            })}

            {/* Dépôt positionné à l'heure de départ */}
            {tournee.heureDepart && (
              <div
                className="absolute flex items-center justify-center cursor-pointer group"
                style={{
                  left: `${getTimePosition(tournee.heureDepart) || 0}%`,
                  transform: 'translateX(-50%)',
                  top: '50%',
                  marginTop: '-14px'
                }}
                title={`Départ: ${formatTime(tournee.heureDepart)}`}
                onClick={() => onSelectDepot?.(selectedDepotId === tournee.id ? null : tournee.id)}
              >
                <div
                  className={clsx(
                    'w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-bold shadow-md transition-all',
                    selectedDepotId === tournee.id && 'ring-2 ring-offset-1 ring-amber-400 scale-110'
                  )}
                  style={{ backgroundColor: chauffeurColor }}
                >
                  D
                </div>
                {/* Tooltip au survol */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    Dépôt - Départ {formatTime(tournee.heureDepart)}
                  </div>
                </div>
              </div>
            )}

            {/* Points positionnés sur la timeline au début du créneau */}
            <div className="absolute inset-0 flex items-center">
              {points.map((point, index) => {
                // Position basée sur le créneau de début uniquement
                const position = getTimePosition(point.creneauDebut);
                const client = point.client as Client | undefined;
                const produits = point.produits as PointProduit[] | undefined;
                const firstProduct = produits?.[0]?.produit as Produit | undefined;
                // Utiliser l'ETA calculée par le backend (OSRM + durées de service)
                const timeStatus = getTimeStatusFromETA(
                  point.heureArriveeEstimee,
                  point.creneauDebut,
                  point.creneauFin
                );

                // Si pas de créneau défini, ne pas afficher sur la frise
                if (position === null) return null;

                return (
                  <ChronologicalPoint
                    key={point.id}
                    point={point}
                    tourneeId={tournee.id}
                    position={position}
                    index={index}
                    isSelected={selectedPointId === point.id}
                    onSelect={(id) => onSelectPoint?.(selectedPointId === id ? null : id)}
                    color={firstProduct?.couleur || chauffeurColor}
                    timeStatus={timeStatus}
                    clientName={client?.nom}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Liste des points (cartes) - toujours visible */}
      <div className="px-3 py-2">
        <SortableContext items={pointIds} strategy={horizontalListSortingStrategy}>
          {points.length > 0 || true ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {/* Carte Dépôt - toujours affichée */}
              <div
                onClick={() => onSelectDepot?.(selectedDepotId === tournee.id ? null : tournee.id)}
                className={clsx(
                  'px-2.5 py-1.5 rounded-lg border cursor-pointer flex-shrink-0 w-[140px] transition-all duration-150 hover:shadow-md',
                  selectedDepotId === tournee.id && 'ring-2 ring-amber-400 border-amber-400',
                  !tournee.depotLatitude && 'border-dashed'
                )}
                style={{
                  backgroundColor: lightenColor(chauffeurColor, 0.85),
                  borderColor: chauffeurColor,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: chauffeurColor }}
                  >
                    D
                  </div>
                  <div className="font-medium text-xs truncate flex-1">Dépôt</div>
                  {!tournee.depotLatitude && (
                    <span className="text-orange-500 text-[10px]" title="GPS manquant">⚠</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-600">
                  <span>{tournee.heureDepart ? formatTime(tournee.heureDepart) : '07h00'}</span>
                  {tournee.depotAdresse && (
                    <span className="truncate text-[10px] text-gray-400" title={tournee.depotAdresse}>
                      • {tournee.depotAdresse.split(' ').slice(-1)[0]}
                    </span>
                  )}
                </div>
              </div>
              {points.map((point) => {
                const timeStatus = getTimeStatusFromETA(
                  point.heureArriveeEstimee,
                  point.creneauDebut,
                  point.creneauFin
                );
                return (
                  <TimelinePoint
                    key={point.id}
                    point={point}
                    tourneeId={tournee.id}
                    timeStatus={timeStatus}
                    isSelected={selectedPointId === point.id}
                    onSelect={(id) => onSelectPoint?.(selectedPointId === id ? null : id)}
                  />
                );
              })}
              {/* Zone de drop pour le drag */}
              {isDragging && (
                <div className={clsx(
                  'w-[170px] flex-shrink-0 border-2 border-dashed rounded-lg flex items-center justify-center text-xs font-medium transition-all duration-150 py-3',
                  showDropIndicator
                    ? 'border-primary-500 text-primary-700 bg-primary-100'
                    : 'border-gray-300 text-gray-400 bg-gray-50'
                )}>
                  <ArrowDownTrayIcon className="h-4 w-4 mr-1.5" />
                  {showDropIndicator ? 'Relâchez' : 'Ajouter'}
                </div>
              )}
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              {/* Carte Dépôt - section vide, ne devrait plus être atteinte */}
              <div className={clsx(
                'flex-1 py-3 border-2 border-dashed rounded-lg flex items-center justify-center text-xs font-medium transition-all duration-150',
                showDropIndicator
                  ? 'border-primary-500 text-primary-700 bg-primary-100'
                  : 'border-gray-300 text-gray-400'
              )}>
                {isDragging ? (
                  <>
                    <ArrowDownTrayIcon className="h-4 w-4 mr-1.5" />
                    {showDropIndicator ? 'Relâchez pour ajouter' : 'Glissez des points ici'}
                  </>
                ) : (
                  'Aucun point - Glissez des points ici'
                )}
              </div>
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
});

// Point sur la frise chronologique (petit marqueur)
interface ChronologicalPointProps {
  point: Point;
  tourneeId: string;
  position: number;
  index: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  color: string;
  timeStatus: TimeStatus;
  clientName?: string;
}

const ChronologicalPoint = memo(function ChronologicalPoint({
  point,
  position,
  index,
  isSelected,
  onSelect,
  color,
  timeStatus,
  clientName,
}: ChronologicalPointProps) {
  const statusColors: Record<TimeStatus, string> = {
    early: '#3B82F6',
    ontime: '#10B981',
    late: '#EF4444',
    unknown: '#9CA3AF',
  };

  return (
    <div
      className="absolute cursor-pointer group"
      style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
      onClick={() => onSelect(point.id)}
    >
      {/* Marqueur */}
      <div
        className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md transition-all',
          isSelected && 'ring-2 ring-offset-1 ring-amber-400 scale-110'
        )}
        style={{ backgroundColor: color }}
      >
        {index + 1}
      </div>
      {/* Indicateur de statut */}
      <div
        className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white"
        style={{ backgroundColor: statusColors[timeStatus] }}
      />
      {/* Tooltip au survol */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
        <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
          {clientName || 'Client'}
          {point.creneauDebut && (
            <span className="text-gray-300 ml-1">
              {formatTime(point.creneauDebut)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

// Panneau de détail du dépôt avec édition de l'heure de départ et adresse
interface DepotDetailPanelProps {
  tournee: Tournee;
  onClose: () => void;
  onUpdate: (data: { heureDepart?: string; depotAdresse?: string }) => Promise<void>;
}

// Helper pour convertir l'heure au format HH:MM pour les inputs
const formatTimeForInput = (time: string | Date | null | undefined): string => {
  if (!time) return '07:00';
  if (typeof time === 'string' && time.includes('T')) {
    const date = new Date(time);
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  if (typeof time === 'string' && time.includes('h')) {
    return time.replace('h', ':');
  }
  return time as string;
};

const DepotDetailPanel = memo(function DepotDetailPanel({ tournee, onClose, onUpdate }: DepotDetailPanelProps) {
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [editHeureDepart, setEditHeureDepart] = useState(formatTimeForInput(tournee.heureDepart));
  const [editDepotAdresse, setEditDepotAdresse] = useState(tournee.depotAdresse || DEFAULT_DEPOT_ADRESSE);
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveTime = async () => {
    setIsSaving(true);
    try {
      await onUpdate({ heureDepart: editHeureDepart });
      setIsEditingTime(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAddress = async () => {
    setIsSaving(true);
    try {
      await onUpdate({ depotAdresse: editDepotAdresse });
      setIsEditingAddress(false);
    } finally {
      setIsSaving(false);
    }
  };

  const chauffeurColor = tournee.chauffeur?.couleur || '#3B82F6';
  const hasCoordinates = tournee.depotLatitude && tournee.depotLongitude;

  return (
    <div className="w-[300px] bg-white rounded-lg border shadow-sm flex-shrink-0">
      <div
        className="px-3 py-2 border-b flex items-center justify-between"
        style={{ backgroundColor: lightenColor(chauffeurColor, 0.9) }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: chauffeurColor }}
          >
            D
          </div>
          <h3 className="font-semibold text-sm">Dépôt</h3>
          {!hasCoordinates && (
            <span className="text-orange-500 text-xs" title="Coordonnées GPS manquantes">⚠ GPS</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1"
        >
          ×
        </button>
      </div>
      <div className="p-3 space-y-3 text-sm">
        <div>
          <div className="text-[10px] text-gray-400">Livreur</div>
          <div className="font-medium">{tournee.chauffeur?.prenom} {tournee.chauffeur?.nom}</div>
        </div>

        {/* Adresse du dépôt */}
        <div>
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-gray-400">Adresse du dépôt</div>
            {!isEditingAddress && (
              <button
                onClick={() => setIsEditingAddress(true)}
                className="text-gray-400 hover:text-primary-600 p-0.5 rounded transition-colors"
                title="Modifier l'adresse"
              >
                <PencilIcon className="h-3 w-3" />
              </button>
            )}
          </div>
          {isEditingAddress ? (
            <div className="mt-1 space-y-2">
              <input
                type="text"
                value={editDepotAdresse}
                onChange={(e) => setEditDepotAdresse(e.target.value)}
                className="w-full rounded border-gray-300 text-xs py-1 px-2"
                placeholder="Adresse complète avec code postal"
              />
              <div className="flex gap-1">
                <Button size="sm" onClick={handleSaveAddress} isLoading={isSaving}>
                  Enregistrer
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsEditingAddress(false);
                    setEditDepotAdresse(tournee.depotAdresse || DEFAULT_DEPOT_ADRESSE);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-600">
              {tournee.depotAdresse || <span className="text-orange-500 italic">Non définie - cliquez pour ajouter</span>}
            </div>
          )}
          {hasCoordinates && (
            <div className="text-[10px] text-green-600 mt-0.5">✓ Géolocalisé</div>
          )}
        </div>

        {/* Heure de départ */}
        <div>
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-gray-400">Heure de départ</div>
            {!isEditingTime && (
              <button
                onClick={() => setIsEditingTime(true)}
                className="text-gray-400 hover:text-primary-600 p-0.5 rounded transition-colors"
                title="Modifier l'heure"
              >
                <PencilIcon className="h-3 w-3" />
              </button>
            )}
          </div>
          {isEditingTime ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="time"
                value={editHeureDepart}
                onChange={(e) => setEditHeureDepart(e.target.value)}
                className="rounded border-gray-300 text-sm py-1 px-2"
              />
              <Button
                size="sm"
                onClick={handleSaveTime}
                isLoading={isSaving}
              >
                OK
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsEditingTime(false);
                  setEditHeureDepart(formatTimeForInput(tournee.heureDepart));
                }}
              >
                Annuler
              </Button>
            </div>
          ) : (
            <div className="font-semibold text-primary-600">
              {tournee.heureDepart ? formatTime(tournee.heureDepart) : 'Non définie'}
            </div>
          )}
        </div>
        {tournee.heureFinEstimee && (
          <div>
            <div className="text-[10px] text-gray-400">Heure de fin estimée</div>
            <div className="text-xs">{formatTime(tournee.heureFinEstimee)}</div>
          </div>
        )}
        {tournee.distanceTotaleKm != null && (
          <div>
            <div className="text-[10px] text-gray-400">Distance totale</div>
            <div className="text-xs">{tournee.distanceTotaleKm.toFixed(1)} km</div>
          </div>
        )}
        {tournee.dureeTotaleMin != null && (
          <div>
            <div className="text-[10px] text-gray-400">Durée estimée</div>
            <div className="text-xs">
              {Math.floor(tournee.dureeTotaleMin / 60)}h{String(tournee.dureeTotaleMin % 60).padStart(2, '0')}
            </div>
          </div>
        )}
        <div>
          <div className="text-[10px] text-gray-400">Points</div>
          <div className="text-xs">{tournee.nombrePoints || tournee.points?.length || 0} point(s)</div>
        </div>
        {tournee.notes && (
          <div>
            <div className="text-[10px] text-gray-400">Notes</div>
            <div className="text-xs text-gray-600">{tournee.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
});

// Interface pour le formulaire d'édition de point
interface EditPointFormData {
  type: PointType;
  creneauDebut: string;
  creneauFin: string;
  dureePrevue: number;
  notesInternes: string;
  notesClient: string;
  // Édition client
  editClientNom: string;
  editClientEmail: string;
  editClientTelephone: string;
  editClientAdresse: string;
  editClientComplementAdresse: string;
  editClientCodePostal: string;
  editClientVille: string;
  editClientInstructionsAcces: string;
  editClientContactNom: string;
  editClientContactTelephone: string;
}

const initialEditPointFormData: EditPointFormData = {
  type: 'livraison',
  creneauDebut: '',
  creneauFin: '',
  dureePrevue: 30,
  notesInternes: '',
  notesClient: '',
  editClientNom: '',
  editClientEmail: '',
  editClientTelephone: '',
  editClientAdresse: '',
  editClientComplementAdresse: '',
  editClientCodePostal: '',
  editClientVille: '',
  editClientInstructionsAcces: '',
  editClientContactNom: '',
  editClientContactTelephone: '',
};

export default function DailyPlanningPage() {
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const { chauffeurPositions, updateChauffeurPosition, setConnected, setAllPositions } = useSocketStore();
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return format(today, 'yyyy-MM-dd');
  });
  const [tournees, setTournees] = useState<Tournee[]>([]);
  const { data: chauffeurs = [] } = useChauffeurs();
  const [vehicules, setVehicules] = useState<Vehicule[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePoint, setActivePoint] = useState<Point | null>(null);
  const [activePendingPoint, setActivePendingPoint] = useState<{ point: ImportParsedPoint; index: number } | null>(null);
  const [dragOverTourneeId, setDragOverTourneeId] = useState<string | null>(null);
  const [dragOverPendingZone, setDragOverPendingZone] = useState(false);
  const isDraggingAny = activePoint !== null || activePendingPoint !== null;
  const [showMap, setShowMap] = useState(true);
  const [showPending, setShowPending] = useState(true);
  const [selectedTourneeId, setSelectedTourneeId] = useState<string | null>(null);
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedPendingIndex, setSelectedPendingIndex] = useState<number | null>(null);
  const [selectedDepotId, setSelectedDepotId] = useState<string | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();

  // Points en attente de dispatch (persistés dans localStorage par date)
  const [pendingPoints, setPendingPoints] = useState<ImportParsedPoint[]>([]);
  const isDateChanging = useRef(false);

  // Cache des coordonnées clients pour les points à dispatcher
  const clientCoordsCacheRef = useRef<Map<string, { latitude: number; longitude: number }>>(new Map());
  const [clientCoordsVersion, setClientCoordsVersion] = useState(0); // Force re-render when cache updates

  // Modal création tournée
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    chauffeurId: '',
    vehiculeId: '',
    heureDepart: DEFAULT_HEURE_DEPART,
    depotAdresse: DEFAULT_DEPOT_ADRESSE,
    notes: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Import Excel
  const [isImporting, setIsImporting] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal édition point
  const [isEditPointModalOpen, setIsEditPointModalOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<Point | null>(null);
  const [editingTourneeId, setEditingTourneeId] = useState<string | null>(null);
  const [editPointFormData, setEditPointFormData] = useState<EditPointFormData>(initialEditPointFormData);
  const [editPointFormErrors, setEditPointFormErrors] = useState<Partial<EditPointFormData>>({});
  const [isEditingSaving, setIsEditingSaving] = useState(false);

  // Modal édition point pending
  const [isEditPendingModalOpen, setIsEditPendingModalOpen] = useState(false);
  const [editingPendingIndex, setEditingPendingIndex] = useState<number | null>(null);
  const [editPendingFormData, setEditPendingFormData] = useState<Partial<ImportParsedPoint>>({});

  // Modal ajout point pending manuel
  const [isAddPendingModalOpen, setIsAddPendingModalOpen] = useState(false);
  const [addPendingFormData, setAddPendingFormData] = useState<Partial<ImportParsedPoint>>({
    type: 'livraison',
  });
  const [addPendingSelectedProduits, setAddPendingSelectedProduits] = useState<{ id: string; nom: string }[]>([]);
  // Champs spécifiques au mode Livraison + Récupération
  const [addPendingLivraisonDate, setAddPendingLivraisonDate] = useState('');
  const [addPendingRamassageDate, setAddPendingRamassageDate] = useState('');
  const [addPendingRamassageCreneauDebut, setAddPendingRamassageCreneauDebut] = useState('');
  const [addPendingRamassageCreneauFin, setAddPendingRamassageCreneauFin] = useState('');
  const [editPendingSelectedProduits, setEditPendingSelectedProduits] = useState<{ id: string; nom: string }[]>([]);
  const [editPointSelectedProduits, setEditPointSelectedProduits] = useState<{ id: string; nom: string }[]>([]);
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const clientSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Modal duplication de point
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateDate, setDuplicateDate] = useState('');
  const [isDuplicating] = useState(false);
  const [duplicatePointData, setDuplicatePointData] = useState<{
    clientId: string;
    clientName: string;
    societe?: string;
    adresse?: string;
    contactNom?: string;
    contactTelephone?: string;
    type: string;
    creneauDebut?: string;
    creneauFin?: string;
    dureePrevue?: number;
    notesInternes?: string;
    notesClient?: string;
    produitName?: string;
    produitId?: string;
    produitsIds?: { id: string; nom: string }[];
    produits?: { produitId: string; quantite: number }[];
  } | null>(null);

  // Dialog validation tournée
  const [isValidateDialogOpen, setIsValidateDialogOpen] = useState(false);
  const [tourneeToValidate, setTourneeToValidate] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Dialog suppression tournée
  const [isDeleteTourneeDialogOpen, setIsDeleteTourneeDialogOpen] = useState(false);
  const [tourneeToDelete, setTourneeToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Réduit pour un démarrage plus rapide
      },
    })
  );

  // Configuration de mesure optimisée pour fluidité maximale
  const measuring = useMemo(() => ({
    droppable: {
      strategy: MeasuringStrategy.Always,
      frequency: 16, // ~60fps pour une mise à jour ultra-fluide
    },
  }), []);

  // Collision detection personnalisée
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const { active } = args;
    const activeData = active?.data?.current;

    // Récupérer toutes les collisions via les deux stratégies
    const pointerCollisions = pointerWithin(args);
    const rectCollisions = rectIntersection(args);
    const allCollisions = [...pointerCollisions, ...rectCollisions];

    // Helper: trouver une zone tournée dans les collisions
    const findTourneeZone = (collisions: typeof pointerCollisions, excludeTourneeId?: string) => {
      return collisions.find(c => {
        const id = String(c.id);
        if (!id.startsWith('tournee-')) return false;
        if (excludeTourneeId && id === `tournee-${excludeTourneeId}`) return false;
        return true;
      });
    };

    // Helper: trouver la pending-zone
    const findPendingZone = (collisions: typeof pointerCollisions) => {
      return collisions.find(c => c.id === 'pending-zone');
    };

    // Pour les points assignés (drag depuis une tournée)
    if (activeData?.type === 'assigned') {
      const sourceTourneeId = activeData.tourneeId as string;

      // Priorité 1: pending-zone (retirer de la tournée)
      const pendingCollision = findPendingZone(pointerCollisions);
      if (pendingCollision) {
        return [pendingCollision];
      }

      // Priorité 2: autre tournée (déplacer entre tournées)
      const otherTournee = findTourneeZone(pointerCollisions, sourceTourneeId)
        || findTourneeZone(rectCollisions, sourceTourneeId);
      if (otherTournee) {
        return [otherTournee];
      }

      // Priorité 3: point dans la même tournée (réordonnancement)
      const samePointCollision = pointerCollisions.find(c => {
        const id = String(c.id);
        const data = c.data?.droppableContainer?.data?.current;
        return !id.startsWith('tournee-') && id !== 'pending-zone' && data?.tourneeId === sourceTourneeId;
      });
      if (samePointCollision) {
        return [samePointCollision];
      }

      // Priorité 4: closestCenter pour les points dans la même tournée
      const closest = closestCenter(args);
      const closestSamePoint = closest.find(c => {
        const id = String(c.id);
        const data = c.data?.droppableContainer?.data?.current;
        return !id.startsWith('tournee-') && id !== 'pending-zone' && data?.tourneeId === sourceTourneeId;
      });
      if (closestSamePoint) {
        return [closestSamePoint];
      }

      // Fallback: tournée source (pour réordonnancement dans même tournée)
      const sourceTournee = findTourneeZone(allCollisions);
      if (sourceTournee) {
        return [sourceTournee];
      }

      return rectCollisions;
    }

    // Pour les points en attente (pending), privilégier les zones de tournée
    if (activeData?.type === 'pending') {
      const tourneeCollision = findTourneeZone(pointerCollisions) || findTourneeZone(rectCollisions);
      if (tourneeCollision) {
        return [tourneeCollision];
      }
      return pointerCollisions.length > 0 ? pointerCollisions : rectCollisions;
    }

    // Fallback générique
    return pointerCollisions.length > 0 ? pointerCollisions : rectCollisions;
  }, []);

  // Charger les pending points au montage et quand la date change
  useEffect(() => {
    isDateChanging.current = true;
    const saved = localStorage.getItem(`pending-points-${selectedDate}`);
    if (saved) {
      try {
        setPendingPoints(JSON.parse(saved));
      } catch {
        setPendingPoints([]);
      }
    } else {
      setPendingPoints([]);
    }
    // Reset flag après le chargement
    setTimeout(() => {
      isDateChanging.current = false;
    }, 0);
  }, [selectedDate]);

  // Sauvegarder les pending points dans localStorage quand ils changent
  useEffect(() => {
    // Ne pas sauvegarder pendant un changement de date
    if (isDateChanging.current) return;
    localStorage.setItem(`pending-points-${selectedDate}`, JSON.stringify(pendingPoints));
  }, [pendingPoints, selectedDate]);

  // BroadcastChannel pour synchroniser la fenêtre popup de carte
  const broadcastChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    broadcastChannel.current = new BroadcastChannel('tournees-sync');
    return () => {
      broadcastChannel.current?.close();
    };
  }, []);

  // Fonction pour notifier la fenêtre popup des changements avec les données
  const notifyMapPopup = useCallback((updatedTournees?: Tournee[]) => {
    const dataToSend = updatedTournees || tournees;
    broadcastChannel.current?.postMessage({
      type: 'tournees-updated',
      date: selectedDate,
      tournees: dataToSend
    });
  }, [selectedDate, tournees]);

  // Charger données statiques en parallèle (véhicules, produits - chauffeurs via React Query)
  useEffect(() => {
    const loadStaticData = async () => {
      try {
        const [vehiculesResult, produitsResult] = await Promise.all([
          import('@/services/api').then(({ default: api }) => api.get('/vehicules/actifs')),
          produitsService.listActifs(),
        ]);

        setVehicules(vehiculesResult.data.data || []);
        setProduits(produitsResult);
      } catch (error) {
        console.error('Erreur chargement données statiques:', error);
      }
    };
    loadStaticData();
  }, []);

  // Charger les tournées
  const loadTournees = useCallback(async () => {
    setLoading(true);
    try {
      const tourneesResult = await tourneesService.list({ date: selectedDate, limit: 50 });
      // Filter out cancelled tournees
      const activeTournees = tourneesResult.data.filter(t => t.statut !== 'annulee');
      const tourneesWithPoints = await Promise.all(
        activeTournees.map(t => tourneesService.getById(t.id))
      );
      setTournees(tourneesWithPoints);
    } catch (error) {
      console.error('Erreur chargement données:', error);
      toastError('Erreur', 'Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, toastError]);

  useEffect(() => {
    loadTournees();
  }, [loadTournees]);

  // Initialiser la connexion Socket.io pour le suivi GPS temps réel
  useEffect(() => {
    if (!token) return;

    const initSocket = async () => {
      try {
        await socketService.connect(token);
        setConnected(true);

        // Demander toutes les positions actuelles
        socketService.requestAllPositions();
      } catch (error) {
        console.error('[DailyPlanningPage] Socket connection failed:', error);
        setConnected(false);
      }
    };

    initSocket();

    // Écouter les nouvelles positions de chauffeurs
    const handleChauffeurPosition = (data: ChauffeurPosition) => {
      updateChauffeurPosition(data.chauffeurId, data);
    };

    // Écouter toutes les positions (réponse à positions:getAll)
    const handleAllPositions = (positions: ChauffeurPosition[] | Record<string, any>) => {
      setAllPositions(positions);
    };

    socketService.on('chauffeur:position', handleChauffeurPosition);
    socketService.on('positions:all', handleAllPositions);

    return () => {
      socketService.off('chauffeur:position', handleChauffeurPosition);
      socketService.off('positions:all', handleAllPositions);
      // Ne pas déconnecter ici car d'autres composants peuvent utiliser la connexion
    };
  }, [token, setConnected, updateChauffeurPosition, setAllPositions]);

  // Charger les coordonnées des clients pour les points à dispatcher
  useEffect(() => {
    const loadClientCoords = async () => {
      const cache = clientCoordsCacheRef.current;
      // Récupérer les clientIds qui ne sont pas encore dans le cache
      const clientIdsToLoad = pendingPoints
        .filter(p => p.clientId && p.clientFound && !cache.has(p.clientId))
        .map(p => p.clientId!)
        .filter((id, index, arr) => arr.indexOf(id) === index); // Unique

      if (clientIdsToLoad.length === 0) return;

      try {
        let updated = false;
        // Charger les clients un par un
        for (const clientId of clientIdsToLoad) {
          try {
            const client = await clientsService.getById(clientId);
            if (client.latitude && client.longitude) {
              cache.set(clientId, {
                latitude: client.latitude,
                longitude: client.longitude,
              });
              updated = true;
            }
          } catch {
            // Client non trouvé, ignorer
          }
        }
        // Force re-render si on a ajouté des coordonnées
        if (updated) {
          setClientCoordsVersion(v => v + 1);
        }
      } catch (error) {
        console.error('Erreur chargement coordonnées clients:', error);
      }
    };

    loadClientCoords();
  }, [pendingPoints]);

  // Créer les points à dispatcher avec coordonnées pour la carte
  const pendingPointsWithCoords = useMemo((): PendingPointWithCoords[] => {
    // clientCoordsVersion force le recalcul quand le cache est mis à jour
    void clientCoordsVersion;
    const cache = clientCoordsCacheRef.current;
    const result: PendingPointWithCoords[] = [];
    pendingPoints.forEach((point, index) => {
      if (!point.clientId || !point.clientFound) return;
      const coords = cache.get(point.clientId);
      if (!coords) return;

      result.push({
        index,
        clientName: point.clientName,
        clientId: point.clientId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        type: point.type,
        produitName: point.produitName,
        produitCouleur: point.produitCouleur,
        creneauDebut: point.creneauDebut,
        creneauFin: point.creneauFin,
      });
    });
    return result;
  }, [pendingPoints, clientCoordsVersion]);

  // Transformer les positions des chauffeurs avec infos pour la carte
  const chauffeurPositionsWithInfo = useMemo((): ChauffeurPositionWithInfo[] => {
    const result: ChauffeurPositionWithInfo[] = [];
    chauffeurPositions.forEach((position) => {
      // Trouver le chauffeur correspondant
      const chauffeur = chauffeurs.find((c) => c.id === position.chauffeurId);
      // Ou chercher dans les tournées
      const tournee = tournees.find((t) => t.chauffeurId === position.chauffeurId);
      const chauffeurFromTournee = tournee?.chauffeur;

      const foundChauffeur = chauffeur || chauffeurFromTournee;

      result.push({
        ...position,
        chauffeurNom: foundChauffeur?.nom,
        chauffeurPrenom: foundChauffeur?.prenom,
        chauffeurCouleur: foundChauffeur?.couleur,
        isStale: isPositionStale(position),
      });
    });
    return result;
  }, [chauffeurPositions, chauffeurs, tournees]);

  // Navigation de date
  const goToPreviousDay = () => {
    setSelectedDate(format(subDays(new Date(selectedDate), 1), 'yyyy-MM-dd'));
  };

  const goToNextDay = () => {
    setSelectedDate(format(addDays(new Date(selectedDate), 1), 'yyyy-MM-dd'));
  };

  const goToToday = () => {
    setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
  };

  // Import Excel - fonction commune
  const processExcelFile = async (file: File) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      toastError('Erreur', 'Format non supporté. Utilisez .xlsx, .xls ou .csv');
      return;
    }

    setIsImporting(true);
    try {
      const result = await tourneesService.importPreviewGeneral(file);
      setPendingPoints(result.points);
      setShowPending(true);
      toastSuccess(`${result.points.length} point(s) chargé(s)`);
    } catch (err) {
      toastError('Erreur', (err as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    await processExcelFile(selectedFile);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Drag & drop fichier Excel
  const handleFileDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleFileDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true);
    }
  };

  const handleFileDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Vérifier qu'on quitte vraiment la zone (pas juste un enfant)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDraggingFile(false);
    }
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processExcelFile(files[0]);
    }
  };

  // Drag & drop
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current;

    if (data?.type === 'pending') {
      setActivePendingPoint({ point: data.pendingPoint, index: data.index });
    } else if (data?.point) {
      setActivePoint(data.point as Point);
      // Auto-expand pending zone when dragging a point from a tournée
      setShowPending(true);
    }
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setDragOverTourneeId(null);
      setDragOverPendingZone(false);
      return;
    }

    const overId = over.id as string;
    const overData = over.data.current;

    // Vérifier si on survole la zone pending
    if (overId === 'pending-zone' || overData?.type === 'pending-zone') {
      setDragOverPendingZone(true);
      setDragOverTourneeId(null);
      return;
    }

    setDragOverPendingZone(false);

    // Determine which tournee is being hovered
    if (overId.startsWith('tournee-')) {
      setDragOverTourneeId(overId.replace('tournee-', ''));
    } else if (overData?.tourneeId) {
      setDragOverTourneeId(overData.tourneeId as string);
    } else {
      setDragOverTourneeId(null);
    }
  }, []);

  // Utiliser une ref pour avoir toujours accès aux dernières valeurs sans recreer le callback
  const tourneesRef = useRef(tournees);
  const pendingPointsRef = useRef(pendingPoints);
  useEffect(() => { tourneesRef.current = tournees; }, [tournees]);
  useEffect(() => { pendingPointsRef.current = pendingPoints; }, [pendingPoints]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    // Reset immédiat des états de drag
    setActivePoint(null);
    setActivePendingPoint(null);
    setDragOverTourneeId(null);
    setDragOverPendingZone(false);

    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (!activeData) return;

    const overId = String(over.id);

    // ========== CAS 1: Point pending vers tournée ==========
    if (activeData.type === 'pending') {
      let pendingPoint = activeData.pendingPoint as ImportParsedPoint;
      const pendingIndex = activeData.index as number;

      // Vérifier que le client existe (devrait toujours être le cas maintenant)
      if (!pendingPoint.clientId) {
        toastError('Erreur', 'Ce point n\'a pas de client associé');
        return;
      }

      // Déterminer la tournée cible
      let targetTourneeId: string | null = null;
      if (overId.startsWith('tournee-')) {
        targetTourneeId = overId.replace('tournee-', '');
      } else if (overData?.tourneeId) {
        targetTourneeId = overData.tourneeId as string;
      }
      if (!targetTourneeId) return;

      // Utiliser la ref pour avoir l'état actuel
      const currentTournees = tourneesRef.current;
      const targetTournee = currentTournees.find(t => t.id === targetTourneeId);
      if (!targetTournee) return;

      // Créer l'ID optimiste
      const optimisticId = `opt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const currentPoints = [...(targetTournee.points || [])].sort((a, b) => a.ordre - b.ordre);

      // Déterminer l'index d'insertion
      let insertIndex = currentPoints.length;
      if (overData?.point) {
        const overPointIndex = currentPoints.findIndex(p => p.id === (overData.point as Point).id);
        if (overPointIndex !== -1) insertIndex = overPointIndex + 1;
      }

      // Créer le point optimiste - inclure les coordonnées pour la carte
      const now = new Date().toISOString();
      const clientCoords = clientCoordsCacheRef.current.get(pendingPoint.clientId!);
      const optimisticPoint: Point = {
        id: optimisticId,
        tourneeId: targetTourneeId,
        clientId: pendingPoint.clientId!,
        client: {
          id: pendingPoint.clientId!,
          nom: pendingPoint.clientName,
          actif: true,
          adresse: '',
          codePostal: '',
          ville: '',
          pays: 'France',
          latitude: clientCoords?.latitude,
          longitude: clientCoords?.longitude,
          createdAt: now,
          updatedAt: now,
        } as Client,
        type: (pendingPoint.type as PointType) || 'livraison',
        ordre: insertIndex,
        statut: 'a_faire',
        creneauDebut: pendingPoint.creneauDebut || undefined,
        creneauFin: pendingPoint.creneauFin || undefined,
        notesInternes: pendingPoint.notes || undefined,
        dureePrevue: 30,
        createdAt: now,
        updatedAt: now,
        produits: pendingPoint.produitsIds && pendingPoint.produitsIds.length > 0
          ? pendingPoint.produitsIds.map((p, idx) => ({
              id: `opt-pp-${Date.now()}-${idx}`,
              pointId: optimisticId,
              produitId: p.id,
              produit: {
                id: p.id,
                nom: p.nom,
                actif: true,
                createdAt: now,
                updatedAt: now,
              } as Produit,
              quantite: 1,
            })) as PointProduit[]
          : pendingPoint.produitId ? [{
              id: `opt-pp-${Date.now()}`,
              pointId: optimisticId,
              produitId: pendingPoint.produitId,
              produit: {
                id: pendingPoint.produitId,
                nom: pendingPoint.produitName || '',
                couleur: pendingPoint.produitCouleur || undefined,
                actif: true,
                createdAt: now,
                updatedAt: now,
              } as Produit,
              quantite: 1,
            }] as PointProduit[] : [],
      };

      // Insérer et réordonner
      currentPoints.splice(insertIndex, 0, optimisticPoint);
      const reorderedPoints = currentPoints.map((p, idx) => ({ ...p, ordre: idx }));

      // Calculer les ETAs approximatives pour affichage immédiat des couleurs
      const pointsWithETAs = calculateApproximateETAs(
        reorderedPoints,
        targetTournee.heureDepart as string | null,
        targetTournee.depotLatitude,
        targetTournee.depotLongitude
      );

      // Créer le nouveau tableau de tournées avec ETAs calculées
      const newTournees = currentTournees.map(t => {
        if (t.id === targetTourneeId) {
          return { ...t, points: pointsWithETAs, nombrePoints: pointsWithETAs.length };
        }
        return t;
      });

      // Retirer des pending points
      const newPendingPoints = pendingPointsRef.current.filter((_, i) => i !== pendingIndex);

      // Sauvegarder pour rollback
      const rollbackTournees = currentTournees;
      const rollbackPendingPoints = pendingPointsRef.current;

      // MISE À JOUR IMMÉDIATE avec ETAs approximatives
      setTournees(newTournees);
      setPendingPoints(newPendingPoints);

      // Notifier la popup carte
      broadcastChannel.current?.postMessage({
        type: 'tournees-updated',
        date: selectedDate,
        tournees: newTournees
      });

      // Appel API en arrière-plan - l'API retourne maintenant la tournée complète
      tourneesService.addPoint(targetTourneeId, {
        clientId: pendingPoint.clientId!,
        type: (pendingPoint.type as 'livraison' | 'ramassage' | 'livraison_ramassage') || 'livraison',
        creneauDebut: pendingPoint.creneauDebut || undefined,
        creneauFin: pendingPoint.creneauFin || undefined,
        notesInternes: pendingPoint.notes || undefined,
        produits: pendingPoint.produitsIds && pendingPoint.produitsIds.length > 0
          ? pendingPoint.produitsIds.map(p => ({ produitId: p.id, quantite: 1 }))
          : pendingPoint.produitId ? [{ produitId: pendingPoint.produitId, quantite: 1 }] : [],
      }).then((updatedTournee: Tournee) => {
        // L'API retourne directement la tournée complète avec ETAs OSRM
        setTournees(current => {
          const updated = current.map(t => t.id === targetTourneeId ? updatedTournee : t);
          broadcastChannel.current?.postMessage({
            type: 'tournees-updated',
            date: selectedDate,
            tournees: updated
          });
          return updated;
        });
      }).catch(error => {
        // ROLLBACK
        setTournees(rollbackTournees);
        setPendingPoints(rollbackPendingPoints);
        toastError('Erreur', (error as Error).message);
      });

      return;
    }

    // ========== CAS 2: Point assigné vers zone pending ==========
    if (activeData.type === 'assigned' && (overId === 'pending-zone' || overData?.type === 'pending-zone')) {
      const point = activeData.point as Point;
      const sourceTourneeId = activeData.tourneeId as string;
      const client = point.client as Client | undefined;
      const produits = point.produits as PointProduit[] | undefined;
      const firstProduct = produits?.[0]?.produit as Produit | undefined;

      // Convertir en ImportParsedPoint
      const newPendingPoint: ImportParsedPoint = {
        clientName: client?.nom || 'Client inconnu',
        clientId: client?.id,
        clientFound: !!client?.id,
        societe: undefined,
        produitName: firstProduct?.nom,
        produitCouleur: firstProduct?.couleur,
        produitId: firstProduct?.id,
        produitFound: !!firstProduct || !produits?.length,
        type: point.type,
        creneauDebut: point.creneauDebut ? formatTime(point.creneauDebut) : undefined,
        creneauFin: point.creneauFin ? formatTime(point.creneauFin) : undefined,
        contactNom: client?.contactNom || undefined,
        contactTelephone: client?.contactTelephone || undefined,
        notes: point.notesInternes || undefined,
        errors: [],
      };

      // Utiliser les refs pour l'état actuel
      const currentTournees = tourneesRef.current;
      const sourceTournee = currentTournees.find(t => t.id === sourceTourneeId);
      if (!sourceTournee?.points) return;

      const filteredPoints = sourceTournee.points
        .filter(p => p.id !== point.id)
        .map((p, idx) => ({ ...p, ordre: idx }));

      // Calculer les ETAs approximatives pour les points restants
      const newSourcePoints = calculateApproximateETAs(
        filteredPoints,
        sourceTournee.heureDepart as string | null,
        sourceTournee.depotLatitude,
        sourceTournee.depotLongitude
      );

      const newTournees = currentTournees.map(t => {
        if (t.id === sourceTourneeId) {
          return { ...t, points: newSourcePoints, nombrePoints: newSourcePoints.length };
        }
        return t;
      });

      const newPendingPoints = [...pendingPointsRef.current, newPendingPoint];

      // Sauvegarder pour rollback
      const rollbackTournees = currentTournees;
      const rollbackPendingPoints = pendingPointsRef.current;

      // MISE À JOUR IMMÉDIATE avec ETAs approximatives
      setTournees(newTournees);
      setPendingPoints(newPendingPoints);

      // Notifier la popup carte
      broadcastChannel.current?.postMessage({
        type: 'tournees-updated',
        date: selectedDate,
        tournees: newTournees
      });

      // Appel API en arrière-plan - l'API retourne maintenant la tournée complète
      tourneesService.deletePoint(sourceTourneeId, point.id).then((updatedTournee: Tournee) => {
        // L'API retourne directement la tournée complète avec ETAs OSRM
        setTournees(current => {
          const updated = current.map(t => t.id === sourceTourneeId ? updatedTournee : t);
          broadcastChannel.current?.postMessage({
            type: 'tournees-updated',
            date: selectedDate,
            tournees: updated
          });
          return updated;
        });
      }).catch(error => {
        // ROLLBACK
        setTournees(rollbackTournees);
        setPendingPoints(rollbackPendingPoints);
        toastError('Erreur', (error as Error).message);
      });

      return;
    }

    // ========== CAS 3: Réordonnancement dans la même tournée ==========
    const sourcePointId = String(active.id);
    const sourceTourneeId = activeData.tourneeId as string;

    let targetTourneeId: string | null = null;
    if (overId.startsWith('tournee-')) {
      targetTourneeId = overId.replace('tournee-', '');
    } else if (overData?.tourneeId) {
      targetTourneeId = overData.tourneeId as string;
    }
    if (!targetTourneeId) return;

    const currentTournees = tourneesRef.current;

    if (sourceTourneeId === targetTourneeId) {
      const tournee = currentTournees.find(t => t.id === sourceTourneeId);
      if (!tournee?.points) return;

      const sortedPoints = [...tournee.points].sort((a, b) => a.ordre - b.ordre);
      const oldIndex = sortedPoints.findIndex(p => p.id === sourcePointId);
      const overPoint = sortedPoints.find(p => p.id === overId);
      const newIndex = overPoint ? sortedPoints.indexOf(overPoint) : sortedPoints.length - 1;

      if (oldIndex === -1 || oldIndex === newIndex) return;

      const newPoints = [...sortedPoints];
      const [movedPoint] = newPoints.splice(oldIndex, 1);
      newPoints.splice(newIndex, 0, movedPoint);
      const reorderedPoints = newPoints.map((p, idx) => ({ ...p, ordre: idx }));

      // Calculer les ETAs approximatives avec le nouvel ordre
      const pointsWithETAs = calculateApproximateETAs(
        reorderedPoints,
        tournee.heureDepart as string | null,
        tournee.depotLatitude,
        tournee.depotLongitude
      );

      const newTournees = currentTournees.map(t => {
        if (t.id === sourceTourneeId) {
          return { ...t, points: pointsWithETAs };
        }
        return t;
      });

      // MISE À JOUR IMMÉDIATE avec ETAs approximatives
      setTournees(newTournees);

      // Notifier la popup carte
      broadcastChannel.current?.postMessage({
        type: 'tournees-updated',
        date: selectedDate,
        tournees: newTournees
      });

      // Appel API en arrière-plan - l'API retourne maintenant la tournée complète
      tourneesService.reorderPoints(sourceTourneeId, reorderedPoints.map(p => p.id)).then((updatedTournee: Tournee) => {
        // L'API retourne directement la tournée complète avec ETAs OSRM
        setTournees(current => {
          const updated = current.map(t => t.id === sourceTourneeId ? updatedTournee : t);
          broadcastChannel.current?.postMessage({
            type: 'tournees-updated',
            date: selectedDate,
            tournees: updated
          });
          return updated;
        });
      }).catch(() => {
        setTournees(currentTournees); // Rollback
        toastError('Erreur', 'Impossible de réordonner');
      });

      return;
    }

    // ========== CAS 4: Déplacement entre tournées ==========
    const sourceTournee = currentTournees.find(t => t.id === sourceTourneeId);
    const targetTournee = currentTournees.find(t => t.id === targetTourneeId);
    if (!sourceTournee?.points || !targetTournee) return;

    const movedPoint = sourceTournee.points.find(p => p.id === sourcePointId);
    if (!movedPoint) return;

    // Retirer de la source et réordonner
    const filteredSourcePoints = sourceTournee.points
      .filter(p => p.id !== sourcePointId)
      .map((p, idx) => ({ ...p, ordre: idx }));

    // Ajouter à la cible
    const sortedTargetPoints = [...(targetTournee.points || [])].sort((a, b) => a.ordre - b.ordre);
    let insertIndex = sortedTargetPoints.length;
    if (overData?.point) {
      const overPointIndex = sortedTargetPoints.findIndex(p => p.id === (overData.point as Point).id);
      if (overPointIndex !== -1) insertIndex = overPointIndex + 1;
    }

    sortedTargetPoints.splice(insertIndex, 0, { ...movedPoint, tourneeId: targetTourneeId });
    const reorderedTargetPoints = sortedTargetPoints.map((p, idx) => ({ ...p, ordre: idx }));

    // Calculer les ETAs approximatives pour les deux tournées
    const newSourcePoints = calculateApproximateETAs(
      filteredSourcePoints,
      sourceTournee.heureDepart as string | null,
      sourceTournee.depotLatitude,
      sourceTournee.depotLongitude
    );

    const newTargetPoints = calculateApproximateETAs(
      reorderedTargetPoints,
      targetTournee.heureDepart as string | null,
      targetTournee.depotLatitude,
      targetTournee.depotLongitude
    );

    const newTournees = currentTournees.map(t => {
      if (t.id === sourceTourneeId) {
        return { ...t, points: newSourcePoints, nombrePoints: newSourcePoints.length };
      }
      if (t.id === targetTourneeId) {
        return { ...t, points: newTargetPoints, nombrePoints: newTargetPoints.length };
      }
      return t;
    });

    // MISE À JOUR IMMÉDIATE avec ETAs approximatives
    setTournees(newTournees);

    // Notifier la popup carte
    broadcastChannel.current?.postMessage({
      type: 'tournees-updated',
      date: selectedDate,
      tournees: newTournees
    });

    // Appel API en arrière-plan - l'API retourne maintenant les deux tournées
    tourneesService.movePoint(sourceTourneeId, sourcePointId, targetTourneeId, insertIndex).then((result: { sourceTournee: Tournee; targetTournee: Tournee }) => {
      // L'API retourne directement les deux tournées complètes avec ETAs OSRM
      setTournees(current => {
        const updated = current.map(t => {
          if (t.id === sourceTourneeId) return result.sourceTournee;
          if (t.id === targetTourneeId) return result.targetTournee;
          return t;
        });
        broadcastChannel.current?.postMessage({
          type: 'tournees-updated',
          date: selectedDate,
          tournees: updated
        });
        return updated;
      });
    }).catch(() => {
      setTournees(currentTournees); // Rollback
      toastError('Erreur', 'Impossible de déplacer le point');
    });
  }, [selectedDate, toastError]);

  const formattedDate = useMemo(() => {
    return format(new Date(selectedDate), 'EEEE d MMMM yyyy', { locale: fr });
  }, [selectedDate]);

  const openCreateModal = () => {
    setFormData({
      chauffeurId: '',
      vehiculeId: '',
      heureDepart: DEFAULT_HEURE_DEPART,
      depotAdresse: DEFAULT_DEPOT_ADRESSE,
      notes: '',
    });
    setFormErrors({});
    setIsCreateModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.chauffeurId) errors.chauffeurId = 'Chauffeur requis';
    if (!formData.heureDepart) errors.heureDepart = 'Heure de départ requise';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateTournee = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const newTournee = await tourneesService.create({
        date: selectedDate,
        chauffeurId: formData.chauffeurId,
        vehiculeId: formData.vehiculeId || undefined,
        heureDepart: formData.heureDepart,
        depotAdresse: formData.depotAdresse || undefined,
        notes: formData.notes || undefined,
      });
      toastSuccess('Tournée créée');
      setIsCreateModalOpen(false);

      // Fetch complete tournee with relations and update state
      const completeTournee = await tourneesService.getById(newTournee.id);
      const newTournees = [...tournees, completeTournee];
      setTournees(newTournees);
      notifyMapPopup(newTournees);
    } catch (error) {
      toastError('Erreur', (error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Ouvrir le modal d'édition de point
  const openEditPointModal = (point: Point, tourneeId: string) => {
    setEditingPoint(point);
    setEditingTourneeId(tourneeId);
    const client = point.client as Client | undefined;
    setEditPointFormData({
      type: point.type,
      creneauDebut: point.creneauDebut ? formatTime(point.creneauDebut) : '',
      creneauFin: point.creneauFin ? formatTime(point.creneauFin) : '',
      dureePrevue: point.dureePrevue,
      notesInternes: point.notesInternes || '',
      notesClient: point.notesClient || '',
      editClientNom: client?.nom || '',
      editClientEmail: client?.email || '',
      editClientTelephone: client?.telephone || '',
      editClientAdresse: client?.adresse || '',
      editClientComplementAdresse: client?.complementAdresse || '',
      editClientCodePostal: client?.codePostal || '',
      editClientVille: client?.ville || '',
      editClientInstructionsAcces: client?.instructionsAcces || '',
      editClientContactNom: client?.contactNom || '',
      editClientContactTelephone: client?.contactTelephone || '',
    });
    setEditPointFormErrors({});
    // Charger les produits existants du point
    const existingProduits = (point.produits || [])
      .filter((pp: PointProduit) => pp.produit)
      .flatMap((pp: PointProduit) => {
        const items: { id: string; nom: string }[] = [];
        for (let i = 0; i < pp.quantite; i++) {
          items.push({ id: pp.produitId, nom: (pp.produit as Produit).nom });
        }
        return items;
      });
    setEditPointSelectedProduits(existingProduits);
    setIsEditPointModalOpen(true);
  };

  // Validation du formulaire d'édition
  const validateEditPointForm = () => {
    const errors: Partial<Record<string, string>> = {};
    if (!editPointFormData.editClientNom) errors.editClientNom = 'Nom requis';
    if (!editPointFormData.editClientAdresse) errors.editClientAdresse = 'Adresse requise';
    if (!editPointFormData.editClientCodePostal) errors.editClientCodePostal = 'Code postal requis';
    if (!editPointFormData.editClientVille) errors.editClientVille = 'Ville requise';
    setEditPointFormErrors(errors as Partial<EditPointFormData>);
    return Object.keys(errors).length === 0;
  };

  // Sauvegarder les modifications du point
  const handleSaveEditPoint = async () => {
    if (!validateEditPointForm() || !editingPoint || !editingTourneeId) return;

    setIsEditingSaving(true);
    const tourneeIdToReload = editingTourneeId;

    try {
      // Mettre à jour le client
      await clientsService.update(editingPoint.clientId, {
        nom: editPointFormData.editClientNom,
        email: editPointFormData.editClientEmail || undefined,
        telephone: editPointFormData.editClientTelephone || undefined,
        adresse: editPointFormData.editClientAdresse,
        complementAdresse: editPointFormData.editClientComplementAdresse || undefined,
        codePostal: editPointFormData.editClientCodePostal,
        ville: editPointFormData.editClientVille,
        instructionsAcces: editPointFormData.editClientInstructionsAcces || undefined,
        contactNom: editPointFormData.editClientContactNom || undefined,
        contactTelephone: editPointFormData.editClientContactTelephone || undefined,
      });

      // Construire les produits groupés par quantité pour le backend
      const produitsGrouped = groupProductsWithQuantity(editPointSelectedProduits).map(p => ({
        produitId: p.id,
        quantite: p.quantite,
      }));

      // Mettre à jour le point
      await tourneesService.updatePoint(tourneeIdToReload, editingPoint.id, {
        type: editPointFormData.type,
        creneauDebut: editPointFormData.creneauDebut || undefined,
        creneauFin: editPointFormData.creneauFin || undefined,
        dureePrevue: editPointFormData.dureePrevue,
        notesInternes: editPointFormData.notesInternes || undefined,
        notesClient: editPointFormData.notesClient || undefined,
        produits: produitsGrouped,
      });

      // Fermer le modal immédiatement
      setIsEditPointModalOpen(false);
      setEditingPoint(null);
      setEditingTourneeId(null);
      setIsEditingSaving(false);

      toastSuccess('Point modifié');

      // Recharger la tournée en arrière-plan
      try {
        const updatedTournee = await tourneesService.getById(tourneeIdToReload);
        const newTournees = tournees.map(t => t.id === tourneeIdToReload ? updatedTournee : t);
        setTournees(newTournees);
        notifyMapPopup(newTournees);
      } catch (reloadError) {
        console.error('Erreur rechargement tournée:', reloadError);
      }
    } catch (error) {
      setIsEditingSaving(false);
      toastError('Erreur', (error as Error).message);
    }
  };

  // Ouvrir le modal d'édition de point pending
  const openEditPendingModal = (index: number) => {
    const point = pendingPoints[index];
    if (!point) return;
    setEditingPendingIndex(index);
    setEditPendingFormData({
      clientName: point.clientName,
      societe: point.societe || '',
      adresse: point.adresse || '',
      type: point.type,
      creneauDebut: point.creneauDebut || '',
      creneauFin: point.creneauFin || '',
      contactNom: point.contactNom || '',
      contactTelephone: point.contactTelephone || '',
      notes: point.notes || '',
      produitName: point.produitName || '',
    });
    setEditPendingSelectedProduits(point.produitsIds || []);
    setIsEditPendingModalOpen(true);
  };

  // Sauvegarder les modifications du point pending
  const handleSaveEditPending = () => {
    if (editingPendingIndex === null) return;

    const updatedPoints = [...pendingPoints];
    updatedPoints[editingPendingIndex] = {
      ...updatedPoints[editingPendingIndex],
      ...editPendingFormData,
      produitName: formatGroupedProducts(editPendingSelectedProduits),
      produitId: editPendingSelectedProduits[0]?.id,
      produitsIds: editPendingSelectedProduits.length > 0 ? editPendingSelectedProduits : undefined,
      produitFound: editPendingSelectedProduits.length > 0,
    };
    setPendingPoints(updatedPoints);
    setIsEditPendingModalOpen(false);
    setEditingPendingIndex(null);
    setEditPendingSelectedProduits([]);
    toastSuccess('Point modifié');
  };

  // Ouvrir le modal de duplication pour un point en tournée
  const openDuplicatePointModal = (point: Point) => {
    const client = point.client as Client | undefined;
    const produitItems = (point.produits || [])
      .filter((pp: PointProduit) => pp.produit)
      .flatMap((pp: PointProduit) => {
        const items: { id: string; nom: string }[] = [];
        for (let i = 0; i < pp.quantite; i++) {
          items.push({ id: pp.produitId, nom: (pp.produit as Produit).nom });
        }
        return items;
      });
    const produitsGrouped = groupProductsWithQuantity(produitItems).map(p => ({ produitId: p.id, quantite: p.quantite }));

    setDuplicatePointData({
      clientId: point.clientId,
      clientName: client?.nom || 'Client',
      societe: client?.societe || undefined,
      adresse: client?.adresse ? `${client.adresse}, ${client.codePostal || ''} ${client.ville || ''}`.trim() : undefined,
      contactNom: client?.contactNom || undefined,
      contactTelephone: client?.contactTelephone || undefined,
      type: point.type,
      creneauDebut: point.creneauDebut ? formatTime(point.creneauDebut) : undefined,
      creneauFin: point.creneauFin ? formatTime(point.creneauFin) : undefined,
      dureePrevue: point.dureePrevue,
      notesInternes: point.notesInternes || undefined,
      notesClient: point.notesClient || undefined,
      produitName: produitItems.length > 0 ? formatGroupedProducts(produitItems) : undefined,
      produitId: produitItems[0]?.id,
      produitsIds: produitItems.length > 0 ? produitItems : undefined,
      produits: produitsGrouped.length > 0 ? produitsGrouped : undefined,
    });
    setDuplicateDate('');
    setIsDuplicateModalOpen(true);
  };

  // Ouvrir le modal de duplication pour un point pending
  const openDuplicatePendingModal = (point: ImportParsedPoint) => {
    const produitsGrouped = point.produitsIds
      ? groupProductsWithQuantity(point.produitsIds).map(p => ({ produitId: p.id, quantite: p.quantite }))
      : point.produitId ? [{ produitId: point.produitId, quantite: 1 }] : [];

    setDuplicatePointData({
      clientId: point.clientId || '',
      clientName: point.clientName,
      societe: point.societe || undefined,
      adresse: point.adresse || undefined,
      contactNom: point.contactNom || undefined,
      contactTelephone: point.contactTelephone || undefined,
      type: point.type,
      creneauDebut: point.creneauDebut || undefined,
      creneauFin: point.creneauFin || undefined,
      dureePrevue: 30,
      notesInternes: point.notes || undefined,
      produitName: point.produitName || undefined,
      produitId: point.produitId,
      produitsIds: point.produitsIds,
      produits: produitsGrouped.length > 0 ? produitsGrouped : undefined,
    });
    setDuplicateDate('');
    setIsDuplicateModalOpen(true);
  };

  // Exécuter la duplication
  const handleDuplicatePoint = () => {
    if (!duplicatePointData || !duplicateDate) {
      toastError('Veuillez sélectionner une date');
      return;
    }

    // Construire le point pending dupliqué
    const newPendingPoint: ImportParsedPoint = {
      clientName: duplicatePointData.clientName,
      clientId: duplicatePointData.clientId || undefined,
      societe: duplicatePointData.societe || '',
      adresse: duplicatePointData.adresse || '',
      type: duplicatePointData.type,
      creneauDebut: duplicatePointData.creneauDebut || '',
      creneauFin: duplicatePointData.creneauFin || '',
      contactNom: duplicatePointData.contactNom || '',
      contactTelephone: duplicatePointData.contactTelephone || '',
      notes: duplicatePointData.notesInternes || duplicatePointData.notesClient || '',
      produitName: duplicatePointData.produitName || '',
      produitId: duplicatePointData.produitId,
      produitsIds: duplicatePointData.produitsIds,
      clientFound: !!duplicatePointData.clientId,
      produitFound: true,
      errors: [],
    };

    // Sauvegarder dans le localStorage de la date cible
    const storageKey = `pending-points-${duplicateDate}`;
    let existingPoints: ImportParsedPoint[] = [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) existingPoints = JSON.parse(saved);
    } catch { /* ignore */ }
    existingPoints.push(newPendingPoint);
    localStorage.setItem(storageKey, JSON.stringify(existingPoints));

    // Fermer le modal et les panneaux de détail
    setIsDuplicateModalOpen(false);
    setDuplicatePointData(null);
    setSelectedPointId(null);
    setSelectedPendingIndex(null);

    const dateStr = format(new Date(duplicateDate + 'T00:00:00'), 'EEEE d MMMM', { locale: fr });
    toastSuccess(`Point dupliqué dans les points à dispatcher du ${dateStr}`);

    // Naviguer vers la date cible
    if (duplicateDate === selectedDate) {
      // Même date : recharger les pending points depuis le localStorage
      setPendingPoints(existingPoints);
    } else {
      setSelectedDate(duplicateDate);
    }
  };

  // Recherche de clients pour autocomplétion
  const handleClientSearch = (searchTerm: string) => {
    if (clientSearchTimeoutRef.current) {
      clearTimeout(clientSearchTimeoutRef.current);
    }

    if (searchTerm.length < 2) {
      setClientSuggestions([]);
      setShowClientSuggestions(false);
      return;
    }

    clientSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await clientsService.search(searchTerm);
        setClientSuggestions(results.slice(0, 8));
        setShowClientSuggestions(true);
      } catch (err) {
        console.error('Erreur recherche clients:', err);
      }
    }, 300);
  };

  // Sélectionner un client depuis les suggestions
  const handleSelectClient = (client: Client) => {
    setAddPendingFormData({
      ...addPendingFormData,
      clientName: client.nom,
      clientId: client.id,
      adresse: client.adresse || '',
      societe: client.societe || addPendingFormData.societe,
    });
    setShowClientSuggestions(false);
    setClientSuggestions([]);
  };

  // Ajouter un nouveau point pending manuellement
  const [isAddingPending, setIsAddingPending] = useState(false);

  // Auto-dispatch des points pending
  const [isAutoDispatching, setIsAutoDispatching] = useState(false);

  const handleAutoDispatch = async () => {
    if (validPendingPoints.length === 0) {
      toastError('Aucun point valide à dispatcher');
      return;
    }

    if (tournees.filter(t => t.statut === 'brouillon' || t.statut === 'planifiee').length === 0) {
      toastError('Aucune tournée disponible pour cette date');
      return;
    }

    setIsAutoDispatching(true);

    try {
      // Préparer les données des points pending pour l'API
      const pointsToDispatch = validPendingPoints.map((point) => ({
        clientId: point.clientId!,
        clientName: point.clientName,
        type: (point.type || 'livraison') as 'livraison' | 'ramassage' | 'livraison_ramassage',
        creneauDebut: point.creneauDebut || undefined,
        creneauFin: point.creneauFin || undefined,
        produitIds: point.produitsIds?.map(p => p.id) || (point.produitId ? [point.produitId] : undefined),
        notes: point.notes || undefined,
        contactNom: point.contactNom || undefined,
        contactTelephone: point.contactTelephone || undefined,
      }));

      const result = await tourneesService.autoDispatch(selectedDate, pointsToDispatch);

      // Mettre à jour les tournées avec les nouvelles données
      if (result.updatedTournees && result.updatedTournees.length > 0) {
        setTournees((prevTournees) => {
          const updatedMap = new Map(result.updatedTournees.map(t => [t.id, t]));
          return prevTournees.map(t => updatedMap.get(t.id) || t);
        });
        notifyMapPopup();
      }

      // Retirer les points dispatchés de la liste pending
      if (result.totalDispatched > 0) {
        const dispatchedIndices = new Set(result.dispatched.map(d => d.pointIndex));
        setPendingPoints((prev) =>
          prev.filter((_, index) => {
            // Trouver l'index dans validPendingPoints
            const validIndex = validPendingPoints.findIndex(vp => vp === prev[index]);
            return validIndex === -1 || !dispatchedIndices.has(validIndex);
          })
        );
      }

      // Afficher le résultat
      if (result.totalDispatched > 0) {
        toastSuccess(`${result.totalDispatched} point(s) réparti(s) automatiquement`);
      }

      if (result.totalFailed > 0) {
        const failedNames = result.failed.slice(0, 3).map(f => f.clientName).join(', ');
        toastError(
          `${result.totalFailed} point(s) non dispatchés`,
          failedNames + (result.failed.length > 3 ? '...' : '')
        );
      }
    } catch (err) {
      toastError('Erreur', (err as Error).message);
    } finally {
      setIsAutoDispatching(false);
    }
  };

  const handleAddPending = async () => {
    if (!addPendingFormData.clientName?.trim()) {
      toastError('Le nom du client est requis');
      return;
    }

    setIsAddingPending(true);

    try {
      let clientId = addPendingFormData.clientId;
      let clientFound = !!clientId;

      // Si pas de client existant sélectionné, créer le client
      if (!clientId) {
        const newClient = await clientsService.create({
          nom: addPendingFormData.clientName.trim(),
          adresse: addPendingFormData.adresse?.trim() || 'Adresse à définir',
          telephone: addPendingFormData.contactTelephone || undefined,
          contactNom: addPendingFormData.contactNom || undefined,
          contactTelephone: addPendingFormData.contactTelephone || undefined,
        });
        clientId = newClient.id;
        clientFound = true;
        toastSuccess(`Client "${newClient.nom}" créé`);
      }

      const basePoint = {
        clientName: addPendingFormData.clientName.trim(),
        clientId,
        societe: addPendingFormData.societe || '',
        adresse: addPendingFormData.adresse || '',
        produitName: formatGroupedProducts(addPendingSelectedProduits),
        produitId: addPendingSelectedProduits[0]?.id,
        produitsIds: addPendingSelectedProduits.length > 0 ? addPendingSelectedProduits : undefined,
        contactNom: addPendingFormData.contactNom || '',
        contactTelephone: addPendingFormData.contactTelephone || '',
        notes: addPendingFormData.notes || '',
        clientFound,
        produitFound: addPendingSelectedProduits.length > 0,
        errors: [] as string[],
      };

      if (addPendingFormData.type === 'livraison_ramassage') {
        // Créer 2 points séparés : un pour la livraison, un pour la récupération
        const pointLivraison: ImportParsedPoint = {
          ...basePoint,
          type: 'livraison',
          creneauDebut: addPendingFormData.creneauDebut || '',
          creneauFin: addPendingFormData.creneauFin || '',
        };
        const pointRamassage: ImportParsedPoint = {
          ...basePoint,
          type: 'ramassage',
          creneauDebut: addPendingRamassageCreneauDebut || '',
          creneauFin: addPendingRamassageCreneauFin || '',
        };

        const livraisonDate = addPendingLivraisonDate || selectedDate;
        const ramassageDate = addPendingRamassageDate || selectedDate;

        // Ajouter le point livraison à la date de livraison
        if (livraisonDate === selectedDate) {
          setPendingPoints(prev => [...prev, pointLivraison]);
        } else {
          const key = `pending-points-${livraisonDate}`;
          let existing: ImportParsedPoint[] = [];
          try { const s = localStorage.getItem(key); if (s) existing = JSON.parse(s); } catch { /* ignore */ }
          existing.push(pointLivraison);
          localStorage.setItem(key, JSON.stringify(existing));
        }

        // Ajouter le point ramassage à la date de récupération
        if (ramassageDate === selectedDate) {
          setPendingPoints(prev => [...prev, pointRamassage]);
        } else {
          const key = `pending-points-${ramassageDate}`;
          let existing: ImportParsedPoint[] = [];
          try { const s = localStorage.getItem(key); if (s) existing = JSON.parse(s); } catch { /* ignore */ }
          existing.push(pointRamassage);
          localStorage.setItem(key, JSON.stringify(existing));
        }

        const msgs: string[] = [];
        if (livraisonDate === selectedDate) msgs.push('Livraison ajoutée');
        else msgs.push(`Livraison ajoutée le ${format(new Date(livraisonDate + 'T00:00:00'), 'd MMM', { locale: fr })}`);
        if (ramassageDate === selectedDate) msgs.push('Récupération ajoutée');
        else msgs.push(`Récupération ajoutée le ${format(new Date(ramassageDate + 'T00:00:00'), 'd MMM', { locale: fr })}`);
        toastSuccess(msgs.join(' + '));
      } else {
        const newPoint: ImportParsedPoint = {
          ...basePoint,
          type: addPendingFormData.type || 'livraison',
          creneauDebut: addPendingFormData.creneauDebut || '',
          creneauFin: addPendingFormData.creneauFin || '',
        };
        setPendingPoints([...pendingPoints, newPoint]);
        toastSuccess('Point ajouté');
      }

      setIsAddPendingModalOpen(false);
      setAddPendingFormData({ type: 'livraison' });
      setAddPendingSelectedProduits([]);
      setAddPendingLivraisonDate('');
      setAddPendingRamassageDate('');
      setAddPendingRamassageCreneauDebut('');
      setAddPendingRamassageCreneauFin('');
      setClientSuggestions([]);
      setShowClientSuggestions(false);
    } catch (err) {
      toastError('Erreur', `Impossible de créer le client: ${(err as Error).message}`);
    } finally {
      setIsAddingPending(false);
    }
  };

  // Ouvrir le dialog de validation
  const openValidateDialog = (tourneeId: string) => {
    setTourneeToValidate(tourneeId);
    setIsValidateDialogOpen(true);
  };

  // Valider une tournée (passer de brouillon à planifiee)
  const confirmValidateTournee = async () => {
    if (!tourneeToValidate) return;

    setIsValidating(true);
    try {
      await tourneesService.update(tourneeToValidate, { statut: 'planifiee' });
      // Mettre à jour uniquement le statut sans perdre les points
      setTournees(current => current.map(t =>
        t.id === tourneeToValidate ? { ...t, statut: 'planifiee' as const } : t
      ));
      toastSuccess('Tournée validée', 'La tournée est maintenant visible par le livreur');
      setIsValidateDialogOpen(false);
      setTourneeToValidate(null);
    } catch (error) {
      toastError('Erreur', (error as Error).message);
    } finally {
      setIsValidating(false);
    }
  };

  // Ouvrir le dialog de suppression
  const openDeleteTourneeDialog = (tourneeId: string) => {
    setTourneeToDelete(tourneeId);
    setIsDeleteTourneeDialogOpen(true);
  };

  // Supprimer une tournée - les points remontent dans "à dispatcher"
  const confirmDeleteTournee = async () => {
    if (!tourneeToDelete) return;

    setIsDeleting(true);
    try {
      // Récupérer la tournée et ses points avant suppression
      const tournee = tournees.find(t => t.id === tourneeToDelete);
      const pointsToRestore = (tournee?.points || []).map(point => {
        const client = point.client as Client | undefined;
        const produits = point.produits as PointProduit[] | undefined;
        const firstProduct = produits?.[0]?.produit as Produit | undefined;

        const pendingPoint: ImportParsedPoint = {
          clientName: client?.nom || 'Client inconnu',
          clientId: client?.id,
          clientFound: !!client?.id,
          societe: client?.societe || undefined,
          produitName: firstProduct?.nom,
          produitCouleur: firstProduct?.couleur,
          produitId: firstProduct?.id,
          produitsIds: produits?.map(pp => {
            const p = pp.produit as Produit | undefined;
            return p ? { id: p.id, nom: p.nom } : null;
          }).filter((p): p is { id: string; nom: string } => p !== null),
          produitFound: !!firstProduct || !produits?.length,
          type: point.type,
          creneauDebut: point.creneauDebut ? formatTime(point.creneauDebut) : undefined,
          creneauFin: point.creneauFin ? formatTime(point.creneauFin) : undefined,
          contactNom: client?.contactNom || undefined,
          contactTelephone: client?.contactTelephone || undefined,
          notes: point.notesInternes || undefined,
          errors: [],
        };
        return pendingPoint;
      });

      await tourneesService.delete(tourneeToDelete);
      setTournees(current => current.filter(t => t.id !== tourneeToDelete));

      // Remonter les points dans "à dispatcher"
      if (pointsToRestore.length > 0) {
        setPendingPoints(current => [...current, ...pointsToRestore]);
      }

      toastSuccess('Tournée supprimée', pointsToRestore.length > 0
        ? `${pointsToRestore.length} point(s) remis à dispatcher`
        : undefined
      );
      setIsDeleteTourneeDialogOpen(false);
      setTourneeToDelete(null);
      notifyMapPopup();
    } catch (error) {
      toastError('Erreur', (error as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const chauffeurOptions = useMemo(() => [
    { value: '', label: 'Sélectionner un chauffeur' },
    ...chauffeurs.map((c) => ({
      value: c.id,
      label: `${c.prenom} ${c.nom}`,
    })),
  ], [chauffeurs]);

  const validPendingPoints = pendingPoints.filter(p => p.clientFound);
  const pendingPointIds = pendingPoints.map((_, i) => `pending-${i}`);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Planning journalier</h1>
            <p className="text-sm text-gray-500 capitalize">{formattedDate}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={goToPreviousDay}>
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToToday}>
                Aujourd'hui
              </Button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
              />
              <Button variant="outline" size="sm" onClick={goToNextDay}>
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={measuring}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {/* Section 1: Points à dispatcher (timeline horizontale) - Zone de drop fichier */}
            <div
              className={clsx(
                'rounded-lg border overflow-hidden transition-all',
                isDraggingFile
                  ? 'bg-orange-100 border-orange-400 border-2 ring-4 ring-orange-200'
                  : 'bg-orange-50 border-orange-200'
              )}
              onDragOver={handleFileDragOver}
              onDragEnter={handleFileDragEnter}
              onDragLeave={handleFileDragLeave}
              onDrop={handleFileDrop}
            >
              <button
                onClick={() => setShowPending(!showPending)}
                className="w-full px-4 py-2 flex items-center justify-between bg-orange-500 text-white hover:bg-orange-600 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <InboxStackIcon className="h-5 w-5" />
                  <span className="font-semibold text-sm">Points à dispatcher</span>
                  <span className="px-2 py-0.5 text-xs font-medium bg-white/20 rounded">
                    {validPendingPoints.length} valide(s)
                  </span>
                  {pendingPoints.length - validPendingPoints.length > 0 && (
                    <Badge variant="danger" size="sm">
                      {pendingPoints.length - validPendingPoints.length} erreur(s)
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAddPendingModalOpen(true);
                    }}
                    className="text-white hover:bg-white/20 text-xs flex items-center gap-1"
                    title="Ajouter un point manuellement"
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span>Ajouter</span>
                  </Button>
                  {pendingPoints.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingPoints([]);
                      }}
                      className="text-white hover:bg-white/20 text-xs"
                    >
                      Vider
                    </Button>
                  )}
                  {validPendingPoints.length > 0 && tournees.filter(t => t.statut === 'brouillon' || t.statut === 'planifiee').length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoDispatch();
                      }}
                      isLoading={isAutoDispatching}
                      className="text-white hover:bg-white/20 text-xs flex items-center gap-1 bg-white/10"
                      title="Répartir automatiquement les points dans les tournées"
                    >
                      <BoltIcon className="h-4 w-4" />
                      <span>Optimiser</span>
                    </Button>
                  )}
                  {showPending ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                </div>
              </button>

              {showPending && (
                <PendingDropZone
                  isDraggingFile={isDraggingFile}
                  isImporting={isImporting}
                  isDraggingPoint={isDraggingAny && activePoint !== null}
                  isOverPending={dragOverPendingZone}
                  pendingPoints={pendingPoints}
                  pendingPointIds={pendingPointIds}
                  selectedPendingIndex={selectedPendingIndex}
                  onSelectPending={(idx) => {
                    setSelectedPendingIndex(selectedPendingIndex === idx ? null : idx);
                    setSelectedPointId(null);
                    setSelectedDepotId(null);
                  }}
                  onClickImport={() => fileInputRef.current?.click()}
                />
              )}

              {/* Input file caché pour le clic */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Section 2: Carte */}
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="px-4 py-2 flex items-center justify-between bg-gray-100">
                <button
                  onClick={() => setShowMap(!showMap)}
                  className="flex items-center gap-2 hover:text-gray-900 transition-colors"
                >
                  <MapIcon className="h-5 w-5 text-gray-600" />
                  <span className="font-semibold text-sm text-gray-700">Carte</span>
                  {showMap ? <ChevronUpIcon className="h-4 w-4 text-gray-600" /> : <ChevronDownIcon className="h-4 w-4 text-gray-600" />}
                </button>
                <button
                  onClick={() => {
                    const url = `/map-popup?date=${selectedDate}`;
                    window.open(url, 'map-popup', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
                  }}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary-600 transition-colors"
                  title="Ouvrir dans une nouvelle fenêtre"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  <span>Nouvelle fenêtre</span>
                </button>
              </div>

              {showMap && (
                <div className="p-3">
                  <div className="flex gap-3">
                    {/* Carte */}
                    <div className={clsx('h-[300px] transition-all', (selectedPointId || selectedPendingIndex !== null || selectedDepotId) ? 'flex-1' : 'w-full')}>
                      <MultiTourneeMap
                        tournees={
                          showOnlyPending
                            ? [] // N'afficher aucune tournée si on filtre sur les points à dispatcher
                            : selectedTourneeId
                              ? tournees.filter(t => t.id === selectedTourneeId && t.statut !== 'annulee')
                              : tournees.filter(t => t.statut !== 'annulee')
                        }
                        pendingPoints={
                          selectedTourneeId && !showOnlyPending
                            ? [] // N'afficher aucun point pending si on filtre sur une tournée
                            : pendingPointsWithCoords
                        }
                        chauffeurPositions={chauffeurPositionsWithInfo}
                        selectedPointId={selectedPointId}
                        selectedPendingIndex={selectedPendingIndex}
                        selectedDepotId={selectedDepotId}
                        onPointClick={(pointId) => {
                          setSelectedPointId(selectedPointId === pointId ? null : pointId);
                          setSelectedPendingIndex(null);
                          setSelectedDepotId(null);
                        }}
                        onPendingPointClick={(index) => {
                          setSelectedPendingIndex(selectedPendingIndex === index ? null : index);
                          setSelectedPointId(null);
                          setSelectedDepotId(null);
                        }}
                        onDepotClick={(tourneeId) => {
                          setSelectedDepotId(selectedDepotId === tourneeId ? null : tourneeId);
                          setSelectedPointId(null);
                          setSelectedPendingIndex(null);
                        }}
                        className="h-full rounded-lg"
                      />
                    </div>
                    {/* Panneau de détail du point sélectionné */}
                    {selectedPointId && (() => {
                      const point = tournees
                        .flatMap(t => t.points || [])
                        .find(p => p.id === selectedPointId);
                      if (!point) return null;
                      const client = point.client as Client | undefined;
                      const produits = point.produits as PointProduit[] | undefined;
                      const tournee = tournees.find(t => t.points?.some(p => p.id === selectedPointId));

                      // Utiliser l'ETA calculée par le backend (OSRM + durées de service)
                      const pointETA = formatETAFromBackend(point.heureArriveeEstimee);
                      const pointTimeStatus = getTimeStatusFromETA(
                        point.heureArriveeEstimee,
                        point.creneauDebut,
                        point.creneauFin
                      );

                      return (
                        <div className="w-[300px] bg-white rounded-lg border shadow-sm flex-shrink-0">
                          <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
                            <h3 className="font-semibold text-sm">Détail du point</h3>
                            <div className="flex items-center gap-1">
                              {tournee && (
                                <>
                                  <button
                                    onClick={() => openEditPointModal(point, tournee.id)}
                                    className="text-gray-400 hover:text-primary-600 p-1 rounded transition-colors"
                                    title="Modifier le point"
                                  >
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => openDuplicatePointModal(point)}
                                    className="text-gray-400 hover:text-green-600 p-1 rounded transition-colors"
                                    title="Dupliquer le point"
                                  >
                                    <DocumentDuplicateIcon className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => setSelectedPointId(null)}
                                className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          <div className="p-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                            <div className="col-span-2">
                              <div className="font-medium">{client?.nom || 'Non défini'}</div>
                              {client?.societe && <div className="text-xs text-gray-500">{client.societe}</div>}
                            </div>
                            <div className="col-span-2 text-xs text-gray-600">
                              {client?.adresse}, {client?.codePostal} {client?.ville}
                            </div>
                            {client?.adresse && (
                              <div className="col-span-2 flex items-center gap-3">
                                <a
                                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${client.adresse}, ${client.codePostal} ${client.ville}`)}&layer=c`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 hover:underline"
                                >
                                  <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                                  Google Maps
                                </a>
                                <a
                                  href={client?.latitude && client?.longitude
                                    ? `https://waze.com/ul?ll=${client.latitude},${client.longitude}&navigate=yes`
                                    : `https://waze.com/ul?q=${encodeURIComponent(`${client.adresse}, ${client.codePostal} ${client.ville}`)}`
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 hover:underline"
                                >
                                  <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                                  Waze
                                </a>
                              </div>
                            )}
                            {client?.telephone && (
                              <div>
                                <div className="text-[10px] text-gray-400 mb-1">Tél</div>
                                <PhoneNumbers phones={client.telephone} variant="badges" size="sm" />
                              </div>
                            )}
                            <div>
                              <div className="text-[10px] text-gray-400">Type</div>
                              <div className="text-xs capitalize">{point.type.replace('_', ' + ')}</div>
                            </div>
                            {point.creneauDebut && (
                              <div>
                                <div className="text-[10px] text-gray-400">Créneau</div>
                                <div className="text-xs">{formatTime(point.creneauDebut)}{point.creneauFin && `-${formatTime(point.creneauFin)}`}</div>
                              </div>
                            )}
                            {pointETA && (
                              <div>
                                <div className="text-[10px] text-gray-400">ETA</div>
                                <div className={clsx(
                                  'text-xs font-semibold',
                                  pointTimeStatus === 'late' && 'text-red-600',
                                  pointTimeStatus === 'early' && 'text-blue-600',
                                  pointTimeStatus === 'ontime' && 'text-green-600'
                                )}>
                                  {pointETA}
                                  {pointTimeStatus === 'late' && ' (retard)'}
                                  {pointTimeStatus === 'early' && ' (avance)'}
                                </div>
                              </div>
                            )}
                            {tournee && (
                              <div>
                                <div className="text-[10px] text-gray-400">Livreur</div>
                                <div className="text-xs">{tournee.chauffeur?.prenom} {tournee.chauffeur?.nom}</div>
                              </div>
                            )}
                            {produits && produits.length > 0 && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-gray-400">Produits</div>
                                <div className="text-xs">
                                  {produits.map((pp, i) => {
                                    const produit = pp.produit as Produit | undefined;
                                    return produit ? (
                                      <span key={pp.id}>
                                        {i > 0 && ', '}
                                        {produit.nom}{pp.quantite > 1 && ` ×${pp.quantite}`}
                                      </span>
                                    ) : null;
                                  })}
                                </div>
                              </div>
                            )}
                            {point.notesInternes && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-gray-400">Notes</div>
                                <div className="text-xs text-gray-600">{point.notesInternes}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Panneau de détail du point pending sélectionné */}
                    {selectedPendingIndex !== null && pendingPoints[selectedPendingIndex] && (() => {
                      const point = pendingPoints[selectedPendingIndex];
                      return (
                        <div className="w-[300px] bg-white rounded-lg border shadow-sm flex-shrink-0">
                          <div className="px-3 py-2 border-b bg-orange-50 flex items-center justify-between">
                            <h3 className="font-semibold text-sm text-orange-700">Point à dispatcher</h3>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditPendingModal(selectedPendingIndex)}
                                className="text-gray-400 hover:text-orange-600 p-1 rounded transition-colors"
                                title="Modifier le point"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => openDuplicatePendingModal(point)}
                                className="text-gray-400 hover:text-green-600 p-1 rounded transition-colors"
                                title="Dupliquer le point"
                              >
                                <DocumentDuplicateIcon className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => setSelectedPendingIndex(null)}
                                className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          <div className="p-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                            <div className="col-span-2">
                              <div className="font-medium">{point.clientName}</div>
                              {point.societe && <div className="text-xs text-gray-500">{point.societe}</div>}
                            </div>
                            {!point.clientFound && point.adresse && (
                              <div className="col-span-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                Nouveau client - sera créé automatiquement
                              </div>
                            )}
                            <div>
                              <div className="text-[10px] text-gray-400">Type</div>
                              <div className="text-xs capitalize">{point.type?.replace('_', ' + ') || 'Livraison'}</div>
                            </div>
                            {point.creneauDebut && (
                              <div>
                                <div className="text-[10px] text-gray-400">Créneau</div>
                                <div className="text-xs">{point.creneauDebut}{point.creneauFin && `-${point.creneauFin}`}</div>
                              </div>
                            )}
                            {point.contactNom && (
                              <div>
                                <div className="text-[10px] text-gray-400">Contact</div>
                                <div className="text-xs">{point.contactNom}</div>
                              </div>
                            )}
                            {point.contactTelephone && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-gray-400 mb-1">Tél</div>
                                <PhoneNumbers phones={point.contactTelephone} variant="badges" size="sm" />
                              </div>
                            )}
                            {point.produitName && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-gray-400">Produit</div>
                                <div className="text-xs">{point.produitName}</div>
                              </div>
                            )}
                            {point.adresse && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-gray-400">Adresse</div>
                                <div className="text-xs text-gray-600">{point.adresse}</div>
                                <div className="flex items-center gap-3 mt-1">
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point.adresse)}&layer=c`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 hover:underline"
                                  >
                                    <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                                    Google Maps
                                  </a>
                                  <a
                                    href={`https://waze.com/ul?q=${encodeURIComponent(point.adresse)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 hover:underline"
                                  >
                                    <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                                    Waze
                                  </a>
                                </div>
                              </div>
                            )}
                            {point.notes && (
                              <div className="col-span-2">
                                <div className="text-[10px] text-gray-400">Notes</div>
                                <div className="text-xs text-gray-600">{point.notes}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Panneau de détail du dépôt sélectionné */}
                    {selectedDepotId && (() => {
                      const tournee = tournees.find(t => t.id === selectedDepotId);
                      if (!tournee) return null;
                      return (
                        <DepotDetailPanel
                          tournee={tournee}
                          onClose={() => setSelectedDepotId(null)}
                          onUpdate={async (data) => {
                            try {
                              await tourneesService.update(tournee.id, data);
                              toastSuccess(data.depotAdresse ? 'Adresse du dépôt modifiée' : 'Heure de départ modifiée');
                              // Recharger la tournée (le backend aura géocodé l'adresse si besoin)
                              const updatedTournee = await tourneesService.getById(tournee.id);
                              const newTournees = tournees.map(t => t.id === tournee.id ? updatedTournee : t);
                              setTournees(newTournees);
                              notifyMapPopup(newTournees);
                            } catch (error) {
                              toastError('Erreur', (error as Error).message);
                            }
                          }}
                        />
                      );
                    })()}
                  </div>
                  {/* Légende */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {/* Bouton Points à dispatcher */}
                    {pendingPointsWithCoords.length > 0 && (
                      <button
                        onClick={() => {
                          setShowOnlyPending(!showOnlyPending);
                          if (!showOnlyPending) {
                            setSelectedTourneeId(null);
                          }
                        }}
                        className={clsx(
                          'flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-all',
                          showOnlyPending
                            ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-200'
                            : 'border-gray-200 hover:border-orange-300'
                        )}
                      >
                        <div
                          className="w-3 h-3 rounded-full border-2 border-dashed border-orange-500 bg-orange-100"
                        />
                        <span className="text-orange-700">À dispatcher</span>
                        <span className="text-orange-400">({pendingPointsWithCoords.length})</span>
                      </button>
                    )}
                    {/* Boutons des tournées */}
                    {tournees.filter(t => t.statut !== 'annulee').map((tournee, index) => {
                      const isSelected = selectedTourneeId === tournee.id;
                      return (
                        <button
                          key={tournee.id}
                          onClick={() => {
                            setSelectedTourneeId(isSelected ? null : tournee.id);
                            if (!isSelected) {
                              setShowOnlyPending(false);
                            }
                          }}
                          className={clsx(
                            'flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-all',
                            isSelected
                              ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                              : 'border-gray-200 hover:border-gray-300'
                          )}
                        >
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: tournee.chauffeur?.couleur || TOURNEE_HEX_COLORS[index % TOURNEE_HEX_COLORS.length] }}
                          />
                          <span>{tournee.chauffeur?.prenom} {tournee.chauffeur?.nom}</span>
                          <span className="text-gray-400">({tournee.points?.length || 0})</span>
                        </button>
                      );
                    })}
                    {(selectedTourneeId || showOnlyPending) && (
                      <button
                        onClick={() => {
                          setSelectedTourneeId(null);
                          setShowOnlyPending(false);
                        }}
                        className="text-xs px-2 py-1 text-primary-600 hover:underline"
                      >
                        Tout afficher
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Section 3: Tournées (timelines horizontales) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-700 flex items-center gap-2">
                  <TruckIcon className="h-5 w-5" />
                  Tournées ({tournees.length})
                </h2>
                <Button size="sm" onClick={openCreateModal}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Nouvelle tournée
                </Button>
              </div>

              {tournees.length === 0 ? (
                <div className="bg-white rounded-lg border p-8 text-center">
                  <TruckIcon className="mx-auto h-10 w-10 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-500">Aucune tournée pour cette date</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={openCreateModal}>
                    <PlusIcon className="h-4 w-4 mr-1" />
                    Créer une tournée
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {tournees.filter(t => t.statut !== 'annulee').map((tournee, index) => (
                    <TourneeTimeline
                      key={tournee.id}
                      tournee={tournee}
                      colorIndex={index}
                      onEdit={() => navigate(`/tournees/${tournee.id}`)}
                      onDelete={() => openDeleteTourneeDialog(tournee.id)}
                      onValidate={() => openValidateDialog(tournee.id)}
                      selectedPointId={selectedPointId}
                      onSelectPoint={(id) => {
                        setSelectedPointId(id);
                        setSelectedPendingIndex(null);
                        setSelectedDepotId(null);
                      }}
                      selectedDepotId={selectedDepotId}
                      onSelectDepot={(tourneeId) => {
                        setSelectedDepotId(tourneeId);
                        setSelectedPointId(null);
                        setSelectedPendingIndex(null);
                      }}
                      isDragging={isDraggingAny}
                      isTargeted={dragOverTourneeId === tournee.id}
                    />
                  ))}
                </div>
              )}
            </div>

            <DragOverlay
              dropAnimation={{
                duration: 200,
                easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
              }}
            >
              {activePoint && (
                <div className="transform scale-105 shadow-2xl">
                  <TimelinePoint
                    point={activePoint}
                    tourneeId=""
                    timeStatus="unknown"
                    isOverlay
                  />
                </div>
              )}
              {activePendingPoint && (
                <div className="transform scale-105 shadow-2xl">
                  <PendingPointCard
                    point={activePendingPoint.point}
                    index={activePendingPoint.index}
                    isOverlay
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Modal création tournée */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Nouvelle tournée"
      >
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
            Date: <span className="font-semibold capitalize">{formattedDate}</span>
          </div>
          <Select
            label="Chauffeur"
            value={formData.chauffeurId}
            onChange={(e) => setFormData({ ...formData, chauffeurId: e.target.value })}
            options={chauffeurOptions}
            error={formErrors.chauffeurId}
            required
          />
          <Select
            label="Véhicule"
            value={formData.vehiculeId}
            onChange={(e) => setFormData({ ...formData, vehiculeId: e.target.value })}
            options={[
              { value: '', label: 'Sélectionner un véhicule (optionnel)' },
              ...vehicules.map((v) => ({
                value: v.id,
                label: `${v.nom}${v.immatriculation ? ` (${v.immatriculation})` : ''}`,
              })),
            ]}
          />
          <TimeSelect
            label="Heure de départ"
            value={formData.heureDepart}
            onChange={(value) => setFormData({ ...formData, heureDepart: value })}
            error={formErrors.heureDepart}
            required
          />
          <Input
            label="Adresse du dépôt (optionnel)"
            value={formData.depotAdresse}
            onChange={(e) => setFormData({ ...formData, depotAdresse: e.target.value })}
            placeholder="Adresse de départ"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Notes..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateTournee} isLoading={isSaving}>
              Créer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal édition point */}
      <Modal
        isOpen={isEditPointModalOpen}
        onClose={() => setIsEditPointModalOpen(false)}
        title="Modifier le point"
        size="lg"
      >
        <div className="space-y-4">
          {/* Informations du client */}
          <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="text-sm font-semibold text-blue-800 mb-3">Informations du client</h3>
            <Input
              label="Nom du client"
              value={editPointFormData.editClientNom}
              onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientNom: e.target.value })}
              placeholder="Nom du client"
              error={editPointFormErrors.editClientNom}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Email"
                type="email"
                value={editPointFormData.editClientEmail}
                onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientEmail: e.target.value })}
                placeholder="email@exemple.com"
              />
              <Input
                label="Téléphone"
                value={editPointFormData.editClientTelephone}
                onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientTelephone: e.target.value })}
                placeholder="06 12 34 56 78"
              />
            </div>
            <AddressAutocomplete
              label="Adresse"
              value={editPointFormData.editClientAdresse}
              onChange={(val) => setEditPointFormData({ ...editPointFormData, editClientAdresse: val })}
              onSelect={(result: AddressResult) => {
                setEditPointFormData((prev) => ({
                  ...prev,
                  editClientAdresse: result.adresse,
                  editClientCodePostal: result.codePostal,
                  editClientVille: result.ville,
                }));
              }}
              searchClients={(q) => clientsService.search(q)}
              placeholder="Tapez une adresse..."
              error={editPointFormErrors.editClientAdresse}
              required
            />
            <Input
              label="Complément d'adresse"
              value={editPointFormData.editClientComplementAdresse}
              onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientComplementAdresse: e.target.value })}
              placeholder="Bâtiment, étage, etc."
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Code postal"
                value={editPointFormData.editClientCodePostal}
                onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientCodePostal: e.target.value })}
                placeholder="75001"
                error={editPointFormErrors.editClientCodePostal}
                required
              />
              <Input
                label="Ville"
                value={editPointFormData.editClientVille}
                onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientVille: e.target.value })}
                placeholder="Paris"
                error={editPointFormErrors.editClientVille}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Instructions d'accès
              </label>
              <textarea
                value={editPointFormData.editClientInstructionsAcces}
                onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientInstructionsAcces: e.target.value })}
                rows={2}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Code porte, interphone, etc."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Nom du contact"
                value={editPointFormData.editClientContactNom}
                onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientContactNom: e.target.value })}
                placeholder="Prénom Nom"
              />
              <Input
                label="Téléphone du contact"
                value={editPointFormData.editClientContactTelephone}
                onChange={(e) => setEditPointFormData({ ...editPointFormData, editClientContactTelephone: e.target.value })}
                placeholder="06 12 34 56 78"
              />
            </div>
          </div>

          <Select
            label="Type"
            value={editPointFormData.type}
            onChange={(e) => setEditPointFormData({ ...editPointFormData, type: e.target.value as PointType })}
            options={[
              { value: 'livraison', label: 'Livraison' },
              { value: 'ramassage', label: 'Ramassage' },
              { value: 'livraison_ramassage', label: 'Livraison + Ramassage' },
            ]}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <TimeSelect
              label="Créneau début"
              value={editPointFormData.creneauDebut}
              onChange={(value) => setEditPointFormData({ ...editPointFormData, creneauDebut: value })}
            />
            <TimeSelect
              label="Créneau fin"
              value={editPointFormData.creneauFin}
              onChange={(value) => setEditPointFormData({ ...editPointFormData, creneauFin: value })}
            />
          </div>

          <Input
            label="Durée prévue (minutes)"
            type="number"
            min={5}
            max={480}
            value={editPointFormData.dureePrevue}
            onChange={(e) => setEditPointFormData({ ...editPointFormData, dureePrevue: parseInt(e.target.value) || 30 })}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Produits
            </label>
            {editPointSelectedProduits.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {groupProductsWithQuantity(editPointSelectedProduits).map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-800 text-sm rounded-full"
                  >
                    {p.nom}{p.quantite > 1 && ` x${p.quantite}`}
                    <button
                      type="button"
                      onClick={() => {
                        const idx = editPointSelectedProduits.findIndex(prod => prod.id === p.id);
                        if (idx !== -1) {
                          setEditPointSelectedProduits(editPointSelectedProduits.filter((_, i) => i !== idx));
                        }
                      }}
                      className="hover:text-primary-600"
                      title="Retirer un exemplaire"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                value=""
                onChange={(e) => {
                  const selectedProduit = produits.find(p => p.id === e.target.value);
                  if (selectedProduit) {
                    setEditPointSelectedProduits([...editPointSelectedProduits, { id: selectedProduit.id, nom: selectedProduit.nom }]);
                  }
                }}
              >
                <option value="">-- Ajouter un produit --</option>
                {produits.map(p => (
                  <option key={p.id} value={p.id}>{p.nom}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes internes
            </label>
            <textarea
              value={editPointFormData.notesInternes}
              onChange={(e) => setEditPointFormData({ ...editPointFormData, notesInternes: e.target.value })}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Notes visibles par l'équipe..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes client
            </label>
            <textarea
              value={editPointFormData.notesClient}
              onChange={(e) => setEditPointFormData({ ...editPointFormData, notesClient: e.target.value })}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Instructions pour le client..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsEditPointModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSaveEditPoint} isLoading={isEditingSaving}>
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal édition point pending */}
      <Modal
        isOpen={isEditPendingModalOpen}
        onClose={() => setIsEditPendingModalOpen(false)}
        title="Modifier le point à dispatcher"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Nom du client"
            value={editPendingFormData.clientName || ''}
            onChange={(e) => setEditPendingFormData({ ...editPendingFormData, clientName: e.target.value })}
            required
          />

          <Input
            label="Société"
            value={editPendingFormData.societe || ''}
            onChange={(e) => setEditPendingFormData({ ...editPendingFormData, societe: e.target.value })}
          />

          <AddressAutocomplete
            label="Adresse"
            value={editPendingFormData.adresse || ''}
            onChange={(val) => setEditPendingFormData({ ...editPendingFormData, adresse: val })}
            onSelect={(result: AddressResult) => {
              setEditPendingFormData((prev) => ({
                ...prev,
                adresse: result.source === 'api' ? result.label : result.adresse,
              }));
            }}
            searchClients={(q) => clientsService.search(q)}
            placeholder="Tapez une adresse..."
          />

          <Select
            label="Type"
            value={editPendingFormData.type || 'livraison'}
            onChange={(e) => setEditPendingFormData({ ...editPendingFormData, type: e.target.value })}
            options={[
              { value: 'livraison', label: 'Livraison' },
              { value: 'ramassage', label: 'Ramassage' },
              { value: 'livraison_ramassage', label: 'Livraison + Ramassage' },
            ]}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Créneau début"
              value={editPendingFormData.creneauDebut || ''}
              onChange={(e) => setEditPendingFormData({ ...editPendingFormData, creneauDebut: e.target.value })}
              placeholder="09:00"
            />
            <Input
              label="Créneau fin"
              value={editPendingFormData.creneauFin || ''}
              onChange={(e) => setEditPendingFormData({ ...editPendingFormData, creneauFin: e.target.value })}
              placeholder="11:00"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nom du contact"
              value={editPendingFormData.contactNom || ''}
              onChange={(e) => setEditPendingFormData({ ...editPendingFormData, contactNom: e.target.value })}
            />
            <div>
              <Input
                label="Téléphone du contact"
                value={editPendingFormData.contactTelephone || ''}
                onChange={(e) => setEditPendingFormData({ ...editPendingFormData, contactTelephone: e.target.value })}
                placeholder="06 12 34 56 78"
              />
              <p className="mt-1 text-xs text-gray-500">
                💡 Vous pouvez saisir plusieurs numéros séparés par , / - ou espace
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Produits
            </label>
            {editPendingSelectedProduits.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {groupProductsWithQuantity(editPendingSelectedProduits).map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-800 text-sm rounded-full"
                  >
                    {p.nom}{p.quantite > 1 && ` x${p.quantite}`}
                    <button
                      type="button"
                      onClick={() => {
                        const idx = editPendingSelectedProduits.findIndex(prod => prod.id === p.id);
                        if (idx !== -1) {
                          setEditPendingSelectedProduits(editPendingSelectedProduits.filter((_, i) => i !== idx));
                        }
                      }}
                      className="hover:text-primary-600"
                      title="Retirer un exemplaire"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                value=""
                onChange={(e) => {
                  const selectedProduit = produits.find(p => p.id === e.target.value);
                  if (selectedProduit) {
                    setEditPendingSelectedProduits([...editPendingSelectedProduits, { id: selectedProduit.id, nom: selectedProduit.nom }]);
                  }
                }}
              >
                <option value="">-- Ajouter un produit --</option>
                {produits.map(p => (
                  <option key={p.id} value={p.id}>{p.nom}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={editPendingFormData.notes || ''}
              onChange={(e) => setEditPendingFormData({ ...editPendingFormData, notes: e.target.value })}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsEditPendingModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSaveEditPending}>
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal ajout point pending */}
      <Modal
        isOpen={isAddPendingModalOpen}
        onClose={() => setIsAddPendingModalOpen(false)}
        title="Ajouter un point à dispatcher"
        size="lg"
      >
        <div className="space-y-4">
          <div className="relative">
            <Input
              label="Nom du client"
              value={addPendingFormData.clientName || ''}
              onChange={(e) => {
                const value = e.target.value;
                setAddPendingFormData({ ...addPendingFormData, clientName: value, clientId: undefined });
                handleClientSearch(value);
              }}
              onFocus={() => {
                if (clientSuggestions.length > 0) setShowClientSuggestions(true);
              }}
              required
              autoComplete="off"
            />
            {showClientSuggestions && clientSuggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {clientSuggestions.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => handleSelectClient(client)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium text-sm">{client.nom}</div>
                    {client.adresse && (
                      <div className="text-xs text-gray-500 truncate">{client.adresse}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {addPendingFormData.clientId && (
              <div className="mt-1 text-xs text-green-600">Client existant sélectionné</div>
            )}
            {addPendingFormData.clientName && !addPendingFormData.clientId && addPendingFormData.clientName.length >= 2 && (
              <div className="mt-1 text-xs text-blue-600">Nouveau client - sera créé automatiquement</div>
            )}
          </div>

          <Input
            label="Société"
            value={addPendingFormData.societe || ''}
            onChange={(e) => setAddPendingFormData({ ...addPendingFormData, societe: e.target.value })}
          />

          <AddressAutocomplete
            label="Adresse"
            value={addPendingFormData.adresse || ''}
            onChange={(val) => setAddPendingFormData({ ...addPendingFormData, adresse: val })}
            onSelect={(result: AddressResult) => {
              setAddPendingFormData((prev) => ({
                ...prev,
                adresse: result.source === 'api' ? result.label : result.adresse,
                ...(result.source === 'client' && result.clientId
                  ? { clientId: result.clientId, clientName: result.clientNom || prev.clientName }
                  : {}),
              }));
            }}
            searchClients={(q) => clientsService.search(q)}
            placeholder="Tapez une adresse..."
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAddPendingFormData({ ...addPendingFormData, type: 'livraison' })}
                className={clsx(
                  'flex-1 py-2 px-3 rounded-lg font-medium transition-all text-sm',
                  addPendingFormData.type === 'livraison' || !addPendingFormData.type
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                Livraison
              </button>
              <button
                type="button"
                onClick={() => setAddPendingFormData({ ...addPendingFormData, type: 'ramassage' })}
                className={clsx(
                  'flex-1 py-2 px-3 rounded-lg font-medium transition-all text-sm',
                  addPendingFormData.type === 'ramassage'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                Récupération
              </button>
              <button
                type="button"
                onClick={() => setAddPendingFormData({ ...addPendingFormData, type: 'livraison_ramassage' })}
                className={clsx(
                  'flex-1 py-2 px-3 rounded-lg font-medium transition-all text-sm',
                  addPendingFormData.type === 'livraison_ramassage'
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                Livraison + Récup
              </button>
            </div>
          </div>

          {addPendingFormData.type === 'livraison_ramassage' ? (
            <>
              {/* Mode Livraison + Récupération : dates et créneaux séparés */}
              <div className="space-y-3 p-3 bg-green-50 rounded-lg border border-green-200">
                <h4 className="text-sm font-semibold text-green-800">Livraison</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date de livraison</label>
                  <input
                    type="date"
                    value={addPendingLivraisonDate}
                    onChange={(e) => setAddPendingLivraisonDate(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <WheelTimePicker
                    label="Créneau début"
                    value={addPendingFormData.creneauDebut || ''}
                    onChange={(val) => setAddPendingFormData({ ...addPendingFormData, creneauDebut: val })}
                    placeholder="--:--"
                  />
                  <WheelTimePicker
                    label="Créneau fin"
                    value={addPendingFormData.creneauFin || ''}
                    onChange={(val) => setAddPendingFormData({ ...addPendingFormData, creneauFin: val })}
                    placeholder="--:--"
                  />
                </div>
              </div>
              <div className="space-y-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <h4 className="text-sm font-semibold text-blue-800">Récupération</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date de récupération</label>
                  <input
                    type="date"
                    value={addPendingRamassageDate}
                    onChange={(e) => setAddPendingRamassageDate(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <WheelTimePicker
                    label="Créneau début"
                    value={addPendingRamassageCreneauDebut}
                    onChange={(val) => setAddPendingRamassageCreneauDebut(val)}
                    placeholder="--:--"
                  />
                  <WheelTimePicker
                    label="Créneau fin"
                    value={addPendingRamassageCreneauFin}
                    onChange={(val) => setAddPendingRamassageCreneauFin(val)}
                    placeholder="--:--"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <WheelTimePicker
                label="Créneau début"
                value={addPendingFormData.creneauDebut || ''}
                onChange={(val) => setAddPendingFormData({ ...addPendingFormData, creneauDebut: val })}
                placeholder="--:--"
              />
              <WheelTimePicker
                label="Créneau fin"
                value={addPendingFormData.creneauFin || ''}
                onChange={(val) => setAddPendingFormData({ ...addPendingFormData, creneauFin: val })}
                placeholder="--:--"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nom du contact"
              value={addPendingFormData.contactNom || ''}
              onChange={(e) => setAddPendingFormData({ ...addPendingFormData, contactNom: e.target.value })}
            />
            <div>
              <Input
                label="Téléphone du contact"
                value={addPendingFormData.contactTelephone || ''}
                onChange={(e) => setAddPendingFormData({ ...addPendingFormData, contactTelephone: e.target.value })}
                placeholder="06 12 34 56 78"
              />
              <p className="mt-1 text-xs text-gray-500">
                💡 Vous pouvez saisir plusieurs numéros séparés par , / - ou espace
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Produits
            </label>
            {/* Liste des produits sélectionnés (groupés avec quantités) */}
            {addPendingSelectedProduits.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {groupProductsWithQuantity(addPendingSelectedProduits).map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-800 text-sm rounded-full"
                  >
                    {p.nom}{p.quantite > 1 && ` x${p.quantite}`}
                    <button
                      type="button"
                      onClick={() => {
                        // Retirer une occurrence de ce produit
                        const idx = addPendingSelectedProduits.findIndex(prod => prod.id === p.id);
                        if (idx !== -1) {
                          setAddPendingSelectedProduits(addPendingSelectedProduits.filter((_, i) => i !== idx));
                        }
                      }}
                      className="hover:text-primary-600"
                      title="Retirer un exemplaire"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Dropdown pour ajouter un produit */}
            <div className="flex gap-2">
              <select
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                value=""
                onChange={(e) => {
                  const selectedProduit = produits.find(p => p.id === e.target.value);
                  if (selectedProduit) {
                    setAddPendingSelectedProduits([...addPendingSelectedProduits, { id: selectedProduit.id, nom: selectedProduit.nom }]);
                  }
                }}
              >
                <option value="">-- Ajouter un produit --</option>
                {produits.map(p => (
                  <option key={p.id} value={p.id}>{p.nom}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={addPendingFormData.notes || ''}
              onChange={(e) => setAddPendingFormData({ ...addPendingFormData, notes: e.target.value })}
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setIsAddPendingModalOpen(false)} disabled={isAddingPending}>
              Annuler
            </Button>
            <Button onClick={handleAddPending} isLoading={isAddingPending}>
              Ajouter
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal duplication de point */}
      <Modal
        isOpen={isDuplicateModalOpen}
        onClose={() => setIsDuplicateModalOpen(false)}
        title="Dupliquer le point"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Le point sera dupliqué avec toutes ses caractéristiques (client, produits, créneaux, notes) dans une tournée de la date choisie.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date de destination
            </label>
            <input
              type="date"
              value={duplicateDate}
              onChange={(e) => setDuplicateDate(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setIsDuplicateModalOpen(false)} disabled={isDuplicating}>
              Annuler
            </Button>
            <Button onClick={handleDuplicatePoint} isLoading={isDuplicating} disabled={!duplicateDate}>
              Dupliquer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Dialog validation tournée */}
      <ConfirmDialog
        isOpen={isValidateDialogOpen}
        onClose={() => {
          setIsValidateDialogOpen(false);
          setTourneeToValidate(null);
        }}
        onConfirm={confirmValidateTournee}
        title="Valider la tournée"
        message="La tournée sera visible par le livreur. Confirmez-vous la validation ?"
        confirmText="Valider"
        variant="warning"
        isLoading={isValidating}
      />

      {/* Dialog suppression tournée */}
      <ConfirmDialog
        isOpen={isDeleteTourneeDialogOpen}
        onClose={() => {
          setIsDeleteTourneeDialogOpen(false);
          setTourneeToDelete(null);
        }}
        onConfirm={confirmDeleteTournee}
        title="Supprimer la tournée"
        message="Cette action est irréversible. Tous les points de cette tournée seront également supprimés. Confirmez-vous la suppression ?"
        confirmText="Supprimer"
        variant="danger"
        isLoading={isDeleting}
      />

    </div>
  );
}

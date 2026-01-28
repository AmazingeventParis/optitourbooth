import { useEffect, useRef, memo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Tournee, Client, PointProduit, Produit, ChauffeurPositionWithInfo } from '@/types';

// Fix for default marker icons in Leaflet with bundlers
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Interface pour les points à dispatcher avec coordonnées
export interface PendingPointWithCoords {
  index: number;
  clientName: string;
  clientId?: string;
  latitude: number;
  longitude: number;
  type: string;
  produitName?: string;
  produitCouleur?: string;
  creneauDebut?: string;
  creneauFin?: string;
}

interface MultiTourneeMapProps {
  tournees: Tournee[];
  pendingPoints?: PendingPointWithCoords[];
  chauffeurPositions?: ChauffeurPositionWithInfo[];
  onTourneeClick?: (tournee: Tournee) => void;
  onPointClick?: (pointId: string, tourneeId: string) => void;
  onPendingPointClick?: (index: number) => void;
  onDepotClick?: (tourneeId: string) => void;
  onChauffeurClick?: (chauffeurId: string) => void;
  selectedPointId?: string | null;
  selectedPendingIndex?: number | null;
  selectedDepotId?: string | null;
  className?: string;
}

// Couleurs pour différencier les tournées
const TOURNEE_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
];

// Cache pour les icônes
const iconCache = new Map<string, L.DivIcon>();

const createNumberedIcon = (number: number, color: string, isLate: boolean = false): L.DivIcon => {
  const cacheKey = `multi-${number}-${color}-${isLate}`;

  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const lateIndicator = isLate ? `
    <div style="
      position: absolute;
      top: -2px;
      left: -2px;
      width: 10px;
      height: 10px;
      background-color: #EF4444;
      border-radius: 50%;
      border: 1.5px solid white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    "></div>
  ` : '';

  const icon = L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        position: relative;
        background-color: ${color};
        width: 26px;
        height: 26px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 11px;
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      ">
        ${number}
        ${lateIndicator}
      </div>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  if (iconCache.size > 500) {
    const firstKey = iconCache.keys().next().value;
    if (firstKey) iconCache.delete(firstKey);
  }

  iconCache.set(cacheKey, icon);
  return icon;
};

const createHighlightedIcon = (number: number, color: string, isLate: boolean = false): L.DivIcon => {
  const cacheKey = `highlight-${number}-${color}-${isLate}`;

  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const lateIndicator = isLate ? `
    <div style="
      position: absolute;
      top: -2px;
      left: -2px;
      width: 12px;
      height: 12px;
      background-color: #EF4444;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    "></div>
  ` : '';

  const icon = L.divIcon({
    className: 'custom-marker-highlighted',
    html: `
      <div style="
        position: relative;
        background-color: ${color};
        width: 38px;
        height: 38px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 14px;
        border: 4px solid #FBBF24;
        box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.4), 0 4px 8px rgba(0,0,0,0.4);
        animation: pulse 1.5s ease-in-out infinite;
      ">
        ${number}
        ${lateIndicator}
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      </style>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });

  iconCache.set(cacheKey, icon);
  return icon;
};

// Helper pour afficher le temps écoulé
const getTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'à l\'instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffHour < 24) return `il y a ${diffHour}h`;
  return date.toLocaleString('fr-FR');
};

// Convertir une heure en minutes depuis minuit
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
const getTimeStatusFromETA = (
  heureArriveeEstimee: string | undefined,
  creneauDebut: string | undefined,
  creneauFin: string | undefined
): 'late' | 'early' | 'ontime' | 'unknown' => {
  const etaMinutes = timeToMinutes(heureArriveeEstimee);
  const currentCreneauDebut = timeToMinutes(creneauDebut);
  const currentCreneauFin = timeToMinutes(creneauFin);

  if (etaMinutes === null) {
    return 'unknown';
  }

  if (currentCreneauDebut === null && currentCreneauFin === null) {
    return 'ontime';
  }

  if (currentCreneauFin !== null && etaMinutes > currentCreneauFin) {
    return 'late';
  }

  if (currentCreneauDebut !== null && etaMinutes < currentCreneauDebut) {
    return 'early';
  }

  return 'ontime';
};

const createDepotIcon = (color: string, isSelected: boolean = false): L.DivIcon => {
  const cacheKey = `depot-${color}-${isSelected}`;

  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  // Mêmes dimensions que les points de livraison (26px normal, 34px sélectionné)
  const size = isSelected ? 34 : 26;
  const fontSize = isSelected ? 13 : 11;
  const borderWidth = isSelected ? 3 : 2;

  const icon = L.divIcon({
    className: isSelected ? 'depot-marker-highlighted' : 'depot-marker',
    html: `
      <div style="
        background-color: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: ${fontSize}px;
        border: ${borderWidth}px solid ${isSelected ? '#FBBF24' : 'white'};
        box-shadow: ${isSelected ? '0 0 0 3px rgba(251, 191, 36, 0.4), 0 4px 8px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.3)'};
        ${isSelected ? 'animation: pulse 1.5s ease-in-out infinite;' : ''}
      ">
        D
      </div>
      ${isSelected ? `
        <style>
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
        </style>
      ` : ''}
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  iconCache.set(cacheKey, icon);
  return icon;
};

// Icône pour les chauffeurs (camion avec direction)
const createChauffeurIcon = (
  color: string,
  heading?: number,
  isStale: boolean = false
): L.DivIcon => {
  const cacheKey = `chauffeur-${color}-${heading ?? 'none'}-${isStale}`;

  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  // Rotation based on heading (0 = North)
  const rotation = heading !== undefined ? heading : 0;
  const opacity = isStale ? 0.5 : 1;

  const icon = L.divIcon({
    className: 'chauffeur-marker',
    html: `
      <div style="
        position: relative;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: ${opacity};
      ">
        <!-- Pulse animation for active chauffeurs -->
        ${!isStale ? `
          <div style="
            position: absolute;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background-color: ${color};
            opacity: 0.3;
            animation: chauffeur-pulse 2s ease-out infinite;
          "></div>
        ` : ''}
        <!-- Main marker -->
        <div style="
          position: relative;
          background-color: ${isStale ? '#9CA3AF' : color};
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          transform: rotate(${rotation}deg);
        ">
          <!-- Truck icon -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style="transform: rotate(-${rotation}deg);">
            <path d="M18 18.5c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5zm1.5-9H17V12h4.46L19.5 9.5zM6 18.5c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5zM20 8l3 4v5h-2c0 1.66-1.34 3-3 3s-3-1.34-3-3H9c0 1.66-1.34 3-3 3s-3-1.34-3-3H1V6c0-1.11.89-2 2-2h14v4h3zM3 6v9h.76c.55-.61 1.35-1 2.24-1 .89 0 1.69.39 2.24 1H15V6H3z"/>
          </svg>
        </div>
        <!-- Direction arrow -->
        ${heading !== undefined ? `
          <div style="
            position: absolute;
            top: -8px;
            left: 50%;
            transform: translateX(-50%) rotate(${rotation}deg);
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 10px solid ${isStale ? '#9CA3AF' : color};
          "></div>
        ` : ''}
      </div>
      <style>
        @keyframes chauffeur-pulse {
          0% { transform: scale(1); opacity: 0.3; }
          100% { transform: scale(2); opacity: 0; }
        }
      </style>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  iconCache.set(cacheKey, icon);
  return icon;
};

// Icône pour les points à dispatcher (orange avec bordure pointillée)
const createPendingIcon = (number: number, color?: string, isSelected: boolean = false): L.DivIcon => {
  const cacheKey = `pending-${number}-${color || 'orange'}-${isSelected}`;

  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const bgColor = color || '#F97316'; // orange-500
  const size = isSelected ? 34 : 26;
  const fontSize = isSelected ? 13 : 11;

  const icon = L.divIcon({
    className: 'pending-marker',
    html: `
      <div style="
        position: relative;
        background-color: ${bgColor};
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: ${fontSize}px;
        border: ${isSelected ? '3px' : '2px'} dashed white;
        box-shadow: ${isSelected ? '0 0 0 3px rgba(249, 115, 22, 0.4), 0 4px 8px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.3)'};
        ${isSelected ? 'animation: pulse 1.5s ease-in-out infinite;' : ''}
      ">
        ${number}
      </div>
      ${isSelected ? `
        <style>
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
        </style>
      ` : ''}
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  iconCache.set(cacheKey, icon);
  return icon;
};

const MultiTourneeMap = memo(function MultiTourneeMap({
  tournees,
  pendingPoints = [],
  chauffeurPositions = [],
  onTourneeClick,
  onPointClick,
  onPendingPointClick,
  onDepotClick,
  onChauffeurClick,
  selectedPointId,
  selectedPendingIndex,
  selectedDepotId,
  className = 'h-96',
}: MultiTourneeMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const chauffeurMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLinesRef = useRef<L.Polyline[]>([]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Initialize map centered on France
    mapRef.current = L.map(mapContainerRef.current).setView([46.603354, 1.888334], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapRef.current);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Clear existing routes
    routeLinesRef.current.forEach((line) => line.remove());
    routeLinesRef.current = [];

    const bounds: L.LatLngExpression[] = [];

    // Process each tournee
    tournees.forEach((tournee, tourneeIndex) => {
      // Utiliser la couleur du chauffeur ou une couleur par défaut
      const color = tournee.chauffeur?.couleur || TOURNEE_COLORS[tourneeIndex % TOURNEE_COLORS.length];
      const points = (tournee.points || []).sort((a, b) => a.ordre - b.ordre);
      const routeCoords: L.LatLngExpression[] = [];

      // Add depot marker
      if (tournee.depotLatitude && tournee.depotLongitude) {
        const isDepotSelected = selectedDepotId === tournee.id;
        const depotMarker = L.marker([tournee.depotLatitude, tournee.depotLongitude], {
          icon: createDepotIcon(color, isDepotSelected),
          zIndexOffset: isDepotSelected ? 1000 : 0,
        }).addTo(mapRef.current!);

        const chauffeurName = tournee.chauffeur
          ? `${tournee.chauffeur.prenom} ${tournee.chauffeur.nom}`
          : 'Non assigné';

        depotMarker.bindPopup(`
          <strong>Dépôt - ${chauffeurName}</strong><br/>
          ${tournee.depotAdresse || 'Point de départ'}<br/>
          <em>${points.length} point${points.length > 1 ? 's' : ''}</em>
        `);

        depotMarker.on('click', () => {
          if (onDepotClick) {
            onDepotClick(tournee.id);
          } else if (onTourneeClick) {
            onTourneeClick(tournee);
          }
        });

        markersRef.current.push(depotMarker);
        bounds.push([tournee.depotLatitude, tournee.depotLongitude]);
        routeCoords.push([tournee.depotLatitude, tournee.depotLongitude]);
      }

      // Add point markers
      points.forEach((point, index) => {
        const client = point.client as Client | undefined;
        if (!client?.latitude || !client?.longitude) return;

        // Récupérer la couleur du premier produit
        const produits = point.produits as PointProduit[] | undefined;
        const firstProduct = produits?.[0]?.produit as Produit | undefined;
        const markerColor = firstProduct?.couleur || color;

        // Utiliser l'ETA calculée par le backend (OSRM + durées de service)
        const timeStatus = getTimeStatusFromETA(point.heureArriveeEstimee, point.creneauDebut, point.creneauFin);
        const isLate = timeStatus === 'late';

        const isSelected = selectedPointId === point.id;
        const marker = L.marker([client.latitude, client.longitude], {
          icon: isSelected
            ? createHighlightedIcon(index + 1, markerColor, isLate)
            : createNumberedIcon(index + 1, markerColor, isLate),
          zIndexOffset: isSelected ? 1000 : 0,
        }).addTo(mapRef.current!);

        const chauffeurName = tournee.chauffeur
          ? `${tournee.chauffeur.prenom} ${tournee.chauffeur.nom}`
          : 'Non assigné';

        const typeLabel = {
          livraison: 'Livraison',
          ramassage: 'Ramassage',
          livraison_ramassage: 'Liv. + Ram.',
        }[point.type];

        marker.bindPopup(`
          <strong>${client.nom}</strong><br/>
          ${typeLabel} - ${chauffeurName}<br/>
          ${client.adresse}<br/>
          ${client.codePostal} ${client.ville}
        `);

        marker.on('click', () => {
          if (onPointClick) {
            onPointClick(point.id, tournee.id);
          } else if (onTourneeClick) {
            onTourneeClick(tournee);
          }
        });

        markersRef.current.push(marker);
        bounds.push([client.latitude, client.longitude]);
        routeCoords.push([client.latitude, client.longitude]);
      });

      // Draw route line for this tournee
      if (routeCoords.length > 1) {
        const routeLine = L.polyline(routeCoords, {
          color: color,
          weight: 3,
          opacity: 0.7,
          dashArray: '8, 8',
        }).addTo(mapRef.current!);

        routeLinesRef.current.push(routeLine);
      }
    });

    // Add pending points markers
    pendingPoints.forEach((pendingPoint) => {
      if (!pendingPoint.latitude || !pendingPoint.longitude) return;

      const isSelected = selectedPendingIndex === pendingPoint.index;
      const markerColor = pendingPoint.produitCouleur || '#F97316';

      const marker = L.marker([pendingPoint.latitude, pendingPoint.longitude], {
        icon: createPendingIcon(pendingPoint.index + 1, markerColor, isSelected),
        zIndexOffset: isSelected ? 1000 : 500, // Pending points au-dessus des points assignés
      }).addTo(mapRef.current!);

      const typeLabel = {
        livraison: 'Livraison',
        ramassage: 'Ramassage',
        livraison_ramassage: 'Liv. + Ram.',
      }[pendingPoint.type] || 'Livraison';

      const creneauInfo = pendingPoint.creneauDebut
        ? `<br/>Créneau: ${pendingPoint.creneauDebut}${pendingPoint.creneauFin ? ` - ${pendingPoint.creneauFin}` : ''}`
        : '';

      marker.bindPopup(`
        <strong style="color: #F97316;">À dispatcher</strong><br/>
        <strong>${pendingPoint.clientName}</strong><br/>
        ${typeLabel}${pendingPoint.produitName ? ` - ${pendingPoint.produitName}` : ''}
        ${creneauInfo}
      `);

      marker.on('click', () => {
        if (onPendingPointClick) {
          onPendingPointClick(pendingPoint.index);
        }
      });

      markersRef.current.push(marker);
      bounds.push([pendingPoint.latitude, pendingPoint.longitude]);
    });

    // Fit bounds if we have points (only if no point is selected)
    if (bounds.length > 0 && !selectedPointId && selectedPendingIndex === null && !selectedDepotId) {
      mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, {
        padding: [50, 50],
        maxZoom: 13,
      });
    }
  }, [tournees, pendingPoints, onTourneeClick, onPointClick, onPendingPointClick, onDepotClick, selectedPointId, selectedPendingIndex, selectedDepotId]);

  // Separate effect for chauffeur positions to allow smooth updates without re-rendering all markers
  useEffect(() => {
    if (!mapRef.current) return;

    const existingMarkers = chauffeurMarkersRef.current;
    const currentChauffeurIds = new Set(chauffeurPositions.map((p) => p.chauffeurId));

    // Remove markers for chauffeurs no longer in the list
    existingMarkers.forEach((marker, chauffeurId) => {
      if (!currentChauffeurIds.has(chauffeurId)) {
        marker.remove();
        existingMarkers.delete(chauffeurId);
      }
    });

    // Add or update markers for current chauffeurs
    chauffeurPositions.forEach((position) => {
      const color = position.chauffeurCouleur || '#3B82F6';
      const existingMarker = existingMarkers.get(position.chauffeurId);

      if (existingMarker) {
        // Update existing marker position with smooth animation
        existingMarker.setLatLng([position.latitude, position.longitude]);
        existingMarker.setIcon(createChauffeurIcon(color, position.heading, position.isStale));
      } else {
        // Create new marker
        const marker = L.marker([position.latitude, position.longitude], {
          icon: createChauffeurIcon(color, position.heading, position.isStale),
          zIndexOffset: 2000, // Chauffeurs always on top
        }).addTo(mapRef.current!);

        const chauffeurName = position.chauffeurPrenom && position.chauffeurNom
          ? `${position.chauffeurPrenom} ${position.chauffeurNom}`
          : 'Chauffeur';

        const lastUpdate = new Date(position.timestamp);
        const timeAgo = getTimeAgo(lastUpdate);

        marker.bindPopup(`
          <strong>${chauffeurName}</strong><br/>
          ${position.isStale ? '<span style="color: #EF4444;">Position obsolète</span><br/>' : ''}
          <em>Dernière mise à jour: ${timeAgo}</em>
          ${position.speed ? `<br/>Vitesse: ${Math.round(position.speed * 3.6)} km/h` : ''}
        `);

        marker.on('click', () => {
          if (onChauffeurClick) {
            onChauffeurClick(position.chauffeurId);
          }
        });

        existingMarkers.set(position.chauffeurId, marker);
      }
    });
  }, [chauffeurPositions, onChauffeurClick]);

  // Cleanup chauffeur markers on unmount
  useEffect(() => {
    return () => {
      chauffeurMarkersRef.current.forEach((marker) => marker.remove());
      chauffeurMarkersRef.current.clear();
    };
  }, []);

  return (
    <div
      ref={mapContainerRef}
      className={`rounded-lg overflow-hidden ${className}`}
    />
  );
});

export default MultiTourneeMap;

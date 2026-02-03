import { useEffect, useRef, useMemo, memo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Point, Client, PointProduit, Produit } from '@/types';

// Fix for default marker icons in Leaflet with bundlers
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface RouteMapProps {
  points: Point[];
  depot?: { latitude: number; longitude: number; adresse?: string };
  onPointClick?: (point: Point) => void;
  selectedPointId?: string;
  showRoute?: boolean;
  className?: string;
}

// Couleur par défaut si aucun produit
const DEFAULT_PRODUCT_COLOR = '#6366F1'; // Indigo

/**
 * Récupère la couleur du premier produit du point
 */
const getMarkerColor = (point: Point): string => {
  const produits = point.produits as PointProduit[] | undefined;
  const firstProduct = produits?.[0]?.produit as Produit | undefined;
  return firstProduct?.couleur || DEFAULT_PRODUCT_COLOR;
};

// Cache pour les icônes - évite de recréer les mêmes icônes
const iconCache = new Map<string, L.DivIcon>();

const createNumberedIcon = (number: number, color: string, isSelected: boolean): L.DivIcon => {
  const cacheKey = `${number}-${color}-${isSelected}`;

  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey)!;
  }

  const size = isSelected ? 36 : 30;
  const fontSize = isSelected ? 14 : 12;

  const icon = L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: ${color};
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: ${fontSize}px;
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        ${isSelected ? 'transform: scale(1.2);' : ''}
      ">
        ${number}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  // Limite la taille du cache
  if (iconCache.size > 500) {
    const firstKey = iconCache.keys().next().value;
    if (firstKey) iconCache.delete(firstKey);
  }

  iconCache.set(cacheKey, icon);
  return icon;
};

// Icône dépôt singleton
let depotIconInstance: L.DivIcon | null = null;

const createDepotIcon = (): L.DivIcon => {
  if (depotIconInstance) return depotIconInstance;

  depotIconInstance = L.divIcon({
    className: 'depot-marker',
    html: `
      <div style="
        background-color: #1F2937;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 16px;
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      ">
        D
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  return depotIconInstance;
};

const RouteMap = memo(function RouteMap({
  points,
  depot,
  onPointClick,
  selectedPointId,
  showRoute = true,
  className = 'h-96',
}: RouteMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const routeLineRef = useRef<L.Polyline | null>(null);

  // Mémoisation des points triés pour éviter le tri à chaque render
  const sortedPoints = useMemo(
    () => [...points].sort((a, b) => a.ordre - b.ordre),
    [points]
  );

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

    // Clear existing route
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    const bounds: L.LatLngExpression[] = [];

    // Add depot marker
    if (depot && depot.latitude && depot.longitude) {
      const depotMarker = L.marker([depot.latitude, depot.longitude], {
        icon: createDepotIcon(),
      }).addTo(mapRef.current);

      depotMarker.bindPopup(`<strong>Dépôt</strong><br/>${depot.adresse || 'Point de départ'}`);
      markersRef.current.push(depotMarker);
      bounds.push([depot.latitude, depot.longitude]);
    }

    // Add point markers (sortedPoints déjà mémorisé)
    const routeCoords: L.LatLngExpression[] = [];

    if (depot && depot.latitude && depot.longitude) {
      routeCoords.push([depot.latitude, depot.longitude]);
    }

    sortedPoints.forEach((point, index) => {
      const client = point.client as Client | undefined;
      if (!client?.latitude || !client?.longitude) return;

      const color = getMarkerColor(point);
      const isSelected = point.id === selectedPointId;

      const marker = L.marker([client.latitude, client.longitude], {
        icon: createNumberedIcon(index + 1, color, isSelected),
      }).addTo(mapRef.current!);

      const typeLabel = {
        livraison: 'Livraison',
        ramassage: 'Ramassage',
        livraison_ramassage: 'Livraison + Ramassage',
      }[point.type];

      marker.bindPopup(`
        <strong>${client.nom}</strong><br/>
        ${typeLabel}<br/>
        ${client.adresse}<br/>
        ${client.codePostal} ${client.ville}
        ${point.creneauDebut && point.creneauFin ? `<br/>Créneau: ${point.creneauDebut} - ${point.creneauFin}` : ''}
      `);

      if (onPointClick) {
        marker.on('click', () => onPointClick(point));
      }

      markersRef.current.push(marker);
      bounds.push([client.latitude, client.longitude]);
      routeCoords.push([client.latitude, client.longitude]);
    });

    // Draw route line
    if (showRoute && routeCoords.length > 1) {
      routeLineRef.current = L.polyline(routeCoords, {
        color: '#3B82F6',
        weight: 3,
        opacity: 0.7,
        dashArray: '10, 10',
      }).addTo(mapRef.current);
    }

    // Fit bounds if we have points
    if (bounds.length > 0) {
      mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, {
        padding: [50, 50],
        maxZoom: 14,
      });
    }
  }, [sortedPoints, depot, selectedPointId, showRoute, onPointClick]);

  return (
    <div
      ref={mapContainerRef}
      className={`rounded-lg overflow-hidden ${className}`}
    />
  );
});

export default RouteMap;

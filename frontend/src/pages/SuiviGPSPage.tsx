import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Badge, Button } from '@/components/ui';
import { usersService } from '@/services/users.service';
import { useToast } from '@/hooks/useToast';
import { User, Position } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  TruckIcon,
  MapPinIcon,
  ClockIcon,
  SignalIcon,
  SignalSlashIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface ChauffeurPosition extends Position {
  chauffeur?: User;
  isOnline: boolean;
}

const createChauffeurIcon = (isOnline: boolean, isSelected: boolean) => {
  const color = isOnline ? '#10B981' : '#6B7280';
  const size = isSelected ? 40 : 32;

  return L.divIcon({
    className: 'chauffeur-marker',
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
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        ${isSelected ? 'transform: scale(1.1);' : ''}
      ">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 17H6a2 2 0 01-2-2V7a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-2M8 17l4 4m0 0l4-4m-4 4V9"/>
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

export default function SuiviGPSPage() {
  const { error: showError } = useToast();

  const [chauffeurs, setChauffeurs] = useState<User[]>([]);
  const [positions, setPositions] = useState<Map<string, ChauffeurPosition>>(new Map());
  const [selectedChauffeurId, setSelectedChauffeurId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Simulate GPS positions (in real app, this would come from WebSocket)
  const simulatePositions = useCallback(() => {
    const newPositions = new Map<string, ChauffeurPosition>();

    chauffeurs.forEach((chauffeur) => {
      // Simulate random positions around France
      const baseLat = 46.5 + (Math.random() - 0.5) * 4;
      const baseLng = 2.5 + (Math.random() - 0.5) * 6;

      const existingPos = positions.get(chauffeur.id);
      const lat = existingPos ? existingPos.latitude + (Math.random() - 0.5) * 0.01 : baseLat;
      const lng = existingPos ? existingPos.longitude + (Math.random() - 0.5) * 0.01 : baseLng;

      newPositions.set(chauffeur.id, {
        chauffeurId: chauffeur.id,
        chauffeur,
        latitude: lat,
        longitude: lng,
        accuracy: 10 + Math.random() * 20,
        speed: Math.random() * 60,
        heading: Math.random() * 360,
        timestamp: Date.now(),
        isOnline: Math.random() > 0.2, // 80% chance of being online
      });
    });

    setPositions(newPositions);
  }, [chauffeurs, positions]);

  useEffect(() => {
    fetchChauffeurs();
  }, []);

  useEffect(() => {
    if (chauffeurs.length > 0) {
      simulatePositions();

      // Update positions every 10 seconds
      const interval = setInterval(simulatePositions, 10000);
      return () => clearInterval(interval);
    }
  }, [chauffeurs]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapRef.current = L.map(mapContainerRef.current).setView([46.603354, 1.888334], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapRef.current);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update markers when positions change
  useEffect(() => {
    if (!mapRef.current) return;

    // Update or create markers
    positions.forEach((pos, chauffeurId) => {
      const existingMarker = markersRef.current.get(chauffeurId);
      const isSelected = chauffeurId === selectedChauffeurId;

      if (existingMarker) {
        existingMarker.setLatLng([pos.latitude, pos.longitude]);
        existingMarker.setIcon(createChauffeurIcon(pos.isOnline, isSelected));
      } else {
        const marker = L.marker([pos.latitude, pos.longitude], {
          icon: createChauffeurIcon(pos.isOnline, isSelected),
        }).addTo(mapRef.current!);

        marker.bindPopup(`
          <strong>${pos.chauffeur?.prenom} ${pos.chauffeur?.nom}</strong><br/>
          ${pos.isOnline ? '🟢 En ligne' : '🔴 Hors ligne'}<br/>
          Vitesse: ${pos.speed?.toFixed(0) || 0} km/h
        `);

        marker.on('click', () => {
          setSelectedChauffeurId(chauffeurId);
        });

        markersRef.current.set(chauffeurId, marker);
      }
    });

    // Remove markers for chauffeurs no longer in positions
    markersRef.current.forEach((marker, chauffeurId) => {
      if (!positions.has(chauffeurId)) {
        marker.remove();
        markersRef.current.delete(chauffeurId);
      }
    });
  }, [positions, selectedChauffeurId]);

  // Center on selected chauffeur
  useEffect(() => {
    if (selectedChauffeurId && mapRef.current) {
      const pos = positions.get(selectedChauffeurId);
      if (pos) {
        mapRef.current.setView([pos.latitude, pos.longitude], 12);
      }
    }
  }, [selectedChauffeurId, positions]);

  const fetchChauffeurs = async () => {
    setIsLoading(true);
    try {
      const result = await usersService.listChauffeurs();
      setChauffeurs(result);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const getOnlineCount = () => {
    let count = 0;
    positions.forEach((pos) => {
      if (pos.isOnline) count++;
    });
    return count;
  };

  const handleRefresh = () => {
    simulatePositions();
  };

  const handleCenterAll = () => {
    if (!mapRef.current || positions.size === 0) return;

    const bounds: L.LatLngExpression[] = [];
    positions.forEach((pos) => {
      bounds.push([pos.latitude, pos.longitude]);
    });

    if (bounds.length > 0) {
      mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, {
        padding: [50, 50],
        maxZoom: 10,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suivi GPS</h1>
          <p className="text-gray-500">Position en temps réel des chauffeurs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleRefresh}>
            <ArrowPathIcon className="h-5 w-5 mr-2" />
            Actualiser
          </Button>
          <Button variant="secondary" onClick={handleCenterAll}>
            <MapPinIcon className="h-5 w-5 mr-2" />
            Voir tous
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <TruckIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{chauffeurs.length}</p>
              <p className="text-sm text-gray-500">Chauffeurs</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-lg">
              <SignalIcon className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{getOnlineCount()}</p>
              <p className="text-sm text-gray-500">En ligne</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gray-100 rounded-lg">
              <SignalSlashIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{chauffeurs.length - getOnlineCount()}</p>
              <p className="text-sm text-gray-500">Hors ligne</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Map and List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chauffeurs List */}
        <Card className="p-4 lg:col-span-1">
          <h2 className="font-semibold mb-4">Chauffeurs</h2>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {chauffeurs.map((chauffeur) => {
              const pos = positions.get(chauffeur.id);
              const isSelected = chauffeur.id === selectedChauffeurId;

              return (
                <div
                  key={chauffeur.id}
                  className={clsx(
                    'p-3 rounded-lg cursor-pointer transition-all',
                    isSelected
                      ? 'bg-primary-50 ring-2 ring-primary-500'
                      : 'bg-gray-50 hover:bg-gray-100'
                  )}
                  onClick={() => setSelectedChauffeurId(chauffeur.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">
                      {chauffeur.prenom} {chauffeur.nom}
                    </span>
                    <Badge
                      variant={pos?.isOnline ? 'success' : 'default'}
                      size="sm"
                    >
                      {pos?.isOnline ? 'En ligne' : 'Hors ligne'}
                    </Badge>
                  </div>

                  {pos && (
                    <div className="text-sm text-gray-500 space-y-1">
                      {pos.isOnline && (
                        <>
                          <div className="flex items-center gap-2">
                            <ClockIcon className="h-4 w-4" />
                            <span>
                              Mis à jour {formatDistanceToNow(pos.timestamp, {
                                addSuffix: true,
                                locale: fr,
                              })}
                            </span>
                          </div>
                          {pos.speed !== undefined && pos.speed > 0 && (
                            <div className="flex items-center gap-2">
                              <TruckIcon className="h-4 w-4" />
                              <span>{pos.speed.toFixed(0)} km/h</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {chauffeurs.length === 0 && (
              <p className="text-gray-500 text-center py-8">
                Aucun chauffeur disponible
              </p>
            )}
          </div>
        </Card>

        {/* Map */}
        <Card className="p-4 lg:col-span-2">
          <h2 className="font-semibold mb-4">Carte</h2>
          <div
            ref={mapContainerRef}
            className="h-[500px] rounded-lg overflow-hidden"
          />
        </Card>
      </div>

      {/* Note about simulation */}
      <Card className="p-4 bg-yellow-50 border-yellow-200">
        <p className="text-sm text-yellow-800">
          <strong>Note:</strong> Les positions affichées sont simulées à des fins de démonstration.
          En production, les positions seraient transmises en temps réel via WebSocket depuis
          les appareils des chauffeurs.
        </p>
      </Card>
    </div>
  );
}

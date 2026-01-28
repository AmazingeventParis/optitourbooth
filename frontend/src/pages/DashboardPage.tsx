import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { usersService } from '@/services/users.service';
import { useToast } from '@/hooks/useToast';
import { User, Position } from '@/types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

const createChauffeurIcon = (isOnline: boolean) => {
  const color = isOnline ? '#10B981' : '#6B7280';
  const size = 32;

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
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect>
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
          <circle cx="5.5" cy="18.5" r="2.5"></circle>
          <circle cx="18.5" cy="18.5" r="2.5"></circle>
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { error: showError } = useToast();

  const [chauffeurs, setChauffeurs] = useState<User[]>([]);
  const [positions, setPositions] = useState<Map<string, ChauffeurPosition>>(new Map());
  const [isLoadingChauffeurs, setIsLoadingChauffeurs] = useState(true);

  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Simulate GPS positions
  const simulatePositions = useCallback(() => {
    const newPositions = new Map<string, ChauffeurPosition>();

    chauffeurs.forEach((chauffeur) => {
      // Simulate positions around Île-de-France
      const baseLat = 48.8566 + (Math.random() - 0.5) * 0.5;
      const baseLng = 2.3522 + (Math.random() - 0.5) * 0.8;

      const existingPos = positions.get(chauffeur.id);
      const lat = existingPos ? existingPos.latitude + (Math.random() - 0.5) * 0.005 : baseLat;
      const lng = existingPos ? existingPos.longitude + (Math.random() - 0.5) * 0.005 : baseLng;

      newPositions.set(chauffeur.id, {
        chauffeurId: chauffeur.id,
        chauffeur,
        latitude: lat,
        longitude: lng,
        accuracy: 10 + Math.random() * 20,
        speed: Math.random() * 60,
        heading: Math.random() * 360,
        timestamp: Date.now(),
        isOnline: Math.random() > 0.3,
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
      const interval = setInterval(simulatePositions, 15000);
      return () => clearInterval(interval);
    }
  }, [chauffeurs]);

  // Initialize map
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      mapRef.current = L.map(mapContainerRef.current).setView([48.8566, 2.3522], 10);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(mapRef.current);
    }, 100);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update markers when positions change
  useEffect(() => {
    if (!mapRef.current) return;

    positions.forEach((pos, chauffeurId) => {
      const existingMarker = markersRef.current.get(chauffeurId);

      if (existingMarker) {
        existingMarker.setLatLng([pos.latitude, pos.longitude]);
        existingMarker.setIcon(createChauffeurIcon(pos.isOnline));
      } else {
        const marker = L.marker([pos.latitude, pos.longitude], {
          icon: createChauffeurIcon(pos.isOnline),
        }).addTo(mapRef.current!);

        marker.bindPopup(`
          <strong>${pos.chauffeur?.prenom} ${pos.chauffeur?.nom}</strong><br/>
          ${pos.isOnline ? '🟢 En ligne' : '🔴 Hors ligne'}<br/>
          ${pos.speed ? `Vitesse: ${pos.speed.toFixed(0)} km/h` : ''}
        `);

        markersRef.current.set(chauffeurId, marker);
      }
    });

    markersRef.current.forEach((marker, chauffeurId) => {
      if (!positions.has(chauffeurId)) {
        marker.remove();
        markersRef.current.delete(chauffeurId);
      }
    });
  }, [positions]);

  const fetchChauffeurs = async () => {
    setIsLoadingChauffeurs(true);
    try {
      const result = await usersService.listChauffeurs();
      setChauffeurs(result);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoadingChauffeurs(false);
    }
  };

  const getOnlineCount = () => {
    let count = 0;
    positions.forEach((pos) => {
      if (pos.isOnline) count++;
    });
    return count;
  };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Bonjour {user?.prenom} !
        </h1>
        <p className="text-gray-600">
          Bienvenue sur OptiTour Booth - Votre outil de gestion de tournées
        </p>
      </div>

      {/* Statistiques rapides (placeholder) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Tournées du jour"
          value="0"
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
          color="blue"
        />
        <StatCard
          title="Points en cours"
          value="0"
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          color="green"
        />
        <StatCard
          title="Chauffeurs en ligne"
          value={String(getOnlineCount())}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
          color="purple"
        />
        <StatCard
          title="Incidents"
          value="0"
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
          color="red"
        />
      </div>

      {/* Zone principale (carte + liste) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Carte GPS */}
        <div className="lg:col-span-2 card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-lg font-semibold">Suivi GPS des chauffeurs</h2>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                En ligne ({getOnlineCount()})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-gray-400"></span>
                Hors ligne ({chauffeurs.length - getOnlineCount()})
              </span>
            </div>
          </div>
          <div className="card-body p-0 relative">
            {isLoadingChauffeurs && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              </div>
            )}
            <div ref={mapContainerRef} className="h-96" />
            {!isLoadingChauffeurs && chauffeurs.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                <div className="text-center text-gray-500">
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="mt-2">Aucun chauffeur disponible</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Liste des tournées du jour */}
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-semibold">Tournées du jour</h2>
          </div>
          <div className="card-body">
            <div className="text-center text-gray-500 py-8">
              <svg className="mx-auto h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="mt-2 text-sm">Aucune tournée aujourd'hui</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// Composant carte de statistique
function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'red';
}) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    red: 'bg-red-100 text-red-600',
  };

  return (
    <div className="card">
      <div className="card-body flex items-center">
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
        <div className="ml-4">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

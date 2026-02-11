import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { tourneesService } from '@/services/tournees.service';
import { socketService, PositionUpdate } from '@/services/socket.service';
import { useToast } from '@/hooks/useToast';
import { User, Tournee, Point } from '@/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui';
import { formatTime } from '@/utils/format';
import {
  MapPinIcon,
  TruckIcon,
} from '@heroicons/react/24/outline';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface ChauffeurPosition {
  chauffeurId: string;
  chauffeur?: User;
  latitude: number;
  longitude: number;
  isOnline: boolean;
  speed?: number;
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

/** Get real point count: prefer actual points array, then _count, fallback to nombrePoints */
const getPointCount = (t: Tournee) => t.points?.length ?? t._count?.points ?? t.nombrePoints;

const getStatutBadge = (statut: Tournee['statut']) => {
  const config = {
    brouillon: { variant: 'default' as const, label: 'Brouillon' },
    planifiee: { variant: 'info' as const, label: 'Planifiée' },
    en_cours: { variant: 'warning' as const, label: 'En cours' },
    terminee: { variant: 'success' as const, label: 'Terminée' },
    annulee: { variant: 'danger' as const, label: 'Annulée' },
  };
  const { variant, label } = config[statut];
  return <Badge variant={variant}>{label}</Badge>;
};

// Statut point avec pastille colorée
const pointStatutDot: Record<string, string> = {
  a_faire: 'bg-gray-400',
  en_cours: 'bg-yellow-400',
  termine: 'bg-green-500',
  incident: 'bg-red-500',
  annule: 'bg-gray-300',
};

export default function DashboardPage() {
  const { user, token } = useAuthStore();
  const { error: showError } = useToast();
  const navigate = useNavigate();

  const [todayTournees, setTodayTournees] = useState<Tournee[]>([]);
  const [isLoadingTournees, setIsLoadingTournees] = useState(true);

  // GPS map - positions state that can be updated
  const [positions, setPositions] = useState<Map<string, ChauffeurPosition>>(new Map());
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    fetchTodayTournees();
  }, []);

  // Connect to Socket.io and listen for GPS positions
  useEffect(() => {
    if (!token) return;

    // Connect to socket
    socketService.connect(token).catch((err) => {
      console.error('[Dashboard] Socket connection failed:', err);
    });

    // Handle position updates from chauffeurs
    const handlePositionUpdate = (data: PositionUpdate & { chauffeurId: string }) => {
      console.log('[Dashboard] Position update received:', data);

      setPositions((prev) => {
        const newPositions = new Map(prev);

        // Find chauffeur info from tournees
        const chauffeur = todayTournees
          .map(t => t.chauffeur)
          .find(c => c?.id === data.chauffeurId);

        newPositions.set(data.chauffeurId, {
          chauffeurId: data.chauffeurId,
          chauffeur: chauffeur as User | undefined,
          latitude: data.latitude,
          longitude: data.longitude,
          isOnline: true,
          speed: data.speed,
        });

        return newPositions;
      });
    };

    // Listen for position updates (backend emits 'chauffeur:position' to admins)
    socketService.on('chauffeur:position', handlePositionUpdate);

    return () => {
      socketService.off('chauffeur:position', handlePositionUpdate);
    };
  }, [token, todayTournees]);

  // Initialize map
  useEffect(() => {
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

  // Update markers when real positions arrive
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

  const fetchTodayTournees = async () => {
    setIsLoadingTournees(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const result = await tourneesService.list({ date: today, limit: 50 });
      // Fetch full details (with points) for each tournée
      const detailed = await Promise.all(
        result.data.map((t) => tourneesService.getById(t.id, true))
      );
      setTodayTournees(detailed);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoadingTournees(false);
    }
  };

  const totalPoints = todayTournees.reduce((sum, t) => sum + getPointCount(t), 0);
  const completedPoints = todayTournees.reduce((sum, t) => {
    const pts = (t.points || []) as Point[];
    return sum + pts.filter((p) => p.statut === 'termine').length;
  }, 0);
  const activeDrivers = new Set(todayTournees.map((t) => t.chauffeurId)).size;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Bonjour {user?.prenom} !
          </h1>
          <p className="text-gray-500">
            {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
          </p>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-600">{todayTournees.length}</p>
            <p className="text-gray-500">tournée{todayTournees.length > 1 ? 's' : ''}</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-600">{completedPoints}/{totalPoints}</p>
            <p className="text-gray-500">points</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-600">{activeDrivers}</p>
            <p className="text-gray-500">chauffeur{activeDrivers > 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Tournées du jour - pleine largeur */}
      {isLoadingTournees ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : todayTournees.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-12 text-gray-500">
            <TruckIcon className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <p className="text-lg font-medium">Aucune tournée aujourd'hui</p>
            <p className="text-sm mt-1">Créez une tournée depuis l'onglet Historique ou importez un fichier Excel</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {todayTournees.map((tournee) => (
            <TourneeCard key={tournee.id} tournee={tournee} onClick={() => navigate(`/tournees/${tournee.id}`)} />
          ))}
        </div>
      )}

      {/* Carte GPS */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-semibold">Suivi GPS</h2>
          {positions.size === 0 && (
            <span className="text-sm text-gray-400">En attente de positions GPS...</span>
          )}
        </div>
        <div className="card-body p-0">
          <div ref={mapContainerRef} className="h-72 rounded-b-lg" />
        </div>
      </div>
    </div>
  );
}

// Carte détaillée d'une tournée
function TourneeCard({ tournee, onClick }: { tournee: Tournee; onClick: () => void }) {
  const points = (tournee.points || []) as (Point & { produits?: { quantite: number; produit?: { nom: string } }[] })[];

  const completedCount = points.filter((p) => p.statut === 'termine').length;
  const totalCount = getPointCount(tournee);

  return (
    <div
      className="card cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      {/* Header chauffeur avec barre de couleur */}
      <div
        className="px-4 py-3 rounded-t-lg flex items-center justify-between"
        style={{
          backgroundColor: tournee.chauffeur?.couleur ? `${tournee.chauffeur.couleur}15` : '#f9fafb',
          borderBottom: `3px solid ${tournee.chauffeur?.couleur || '#e5e7eb'}`,
        }}
      >
        <div className="flex items-center gap-2">
          {tournee.chauffeur?.couleur && (
            <div
              className="w-3 h-3 rounded-full flex-shrink-0 border border-white"
              style={{ backgroundColor: tournee.chauffeur.couleur }}
            />
          )}
          <span className="font-semibold text-gray-900">
            {tournee.chauffeur
              ? `${tournee.chauffeur.prenom} ${tournee.chauffeur.nom}`
              : 'Non assigné'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {getStatutBadge(tournee.statut)}
        </div>
      </div>

      {/* Infos rapides */}
      <div className="px-4 py-2 flex items-center gap-4 text-xs text-gray-500 border-b border-gray-100">
        {tournee.heureDepart && (
          <span>Départ {formatTime(tournee.heureDepart)}</span>
        )}
        <span className="flex items-center gap-1">
          <MapPinIcon className="h-3.5 w-3.5" />
          {completedCount}/{totalCount}
        </span>
        {tournee.distanceTotaleKm != null && tournee.distanceTotaleKm > 0 && (
          <span>{tournee.distanceTotaleKm.toFixed(1)} km</span>
        )}
        {tournee.dureeTotaleMin != null && tournee.dureeTotaleMin > 0 && (
          <span>
            {Math.floor(tournee.dureeTotaleMin / 60)}h{String(Math.round(tournee.dureeTotaleMin % 60)).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Liste des points */}
      <div className="px-4 py-2">
        {points.length > 0 ? (
          <div className="space-y-1.5">
            {points.map((pt, idx) => (
              <div key={pt.id} className="flex items-start gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${pointStatutDot[pt.statut] || 'bg-gray-400'}`} />
                <span className="text-gray-400 text-xs w-4 text-right mt-0.5">{idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-800">
                      {pt.client?.societe || pt.client?.nom || 'Client'}
                    </span>
                    {pt.client?.ville && (
                      <span className="text-gray-400 text-xs">({pt.client.ville})</span>
                    )}
                    {(pt.creneauDebut || pt.creneauFin) && (
                      <span className="text-xs text-primary-600 font-medium ml-auto flex-shrink-0">
                        {pt.creneauDebut ? formatTime(pt.creneauDebut) : ''}
                        {pt.creneauDebut && pt.creneauFin ? ' - ' : ''}
                        {pt.creneauFin ? formatTime(pt.creneauFin) : ''}
                      </span>
                    )}
                  </div>
                  {pt.produits && pt.produits.length > 0 && (
                    <p className="text-xs text-gray-400 truncate">
                      {pt.produits.map((pp) => `${pp.quantite}× ${pp.produit?.nom || '?'}`).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-2">Aucun point</p>
        )}
      </div>

    </div>
  );
}

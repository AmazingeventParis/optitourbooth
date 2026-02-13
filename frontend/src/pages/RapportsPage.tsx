import { useState, useEffect, useMemo } from 'react';
import { Card, Select, Button } from '@/components/ui';
import { tourneesService } from '@/services/tournees.service';
import { usersService } from '@/services/users.service';
import { produitsService } from '@/services/produits.service';
import { useToast } from '@/hooks/useToast';
import { Tournee, User, Produit } from '@/types';
import { format, subDays, startOfMonth, startOfWeek, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import {
  TruckIcon,
  MapPinIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowDownTrayIcon,
  CubeIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
  BoltIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

// Couleurs pour les graphiques
const COLORS = {
  primary: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  purple: '#8B5CF6',
  pink: '#EC4899',
  teal: '#14B8A6',
  indigo: '#6366F1',
};

const CHART_COLORS = [COLORS.primary, COLORS.success, COLORS.purple, COLORS.warning, COLORS.pink, COLORS.teal];

// Prix moyen du carburant (modifiable)
const FUEL_PRICE_PER_LITER = 1.75;

interface GlobalStats {
  totalTournees: number;
  tourneesTerminees: number;
  totalPoints: number;
  pointsLivraison: number;
  pointsRamassage: number;
  pointsTermines: number;
  pointsIncidents: number;
  distanceTotale: number;
  dureeTotale: number;
  carburantEstime: number;
  coutCarburant: number;
  tauxPonctualite: number;
}

interface ChauffeurStats {
  id: string;
  nom: string;
  prenom: string;
  couleur: string;
  vehicule?: string;
  tournees: number;
  points: number;
  distance: number;
  carburant: number;
  incidents: number;
  tauxPonctualite: number;
  consommationL100km?: number;
}

interface ProduitStats {
  id: string;
  nom: string;
  couleur: string;
  count: number;
  livraisons: number;
  ramassages: number;
}

interface DailyData {
  date: string;
  dateLabel: string;
  points: number;
  distance: number;
  livraisons: number;
  ramassages: number;
}

export default function RapportsPage() {
  const { error: showError } = useToast();

  const [chauffeurs, setChauffeurs] = useState<User[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [tournees, setTournees] = useState<Tournee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [periode, setPeriode] = useState('30');
  const [chauffeurFilter, setChauffeurFilter] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    fetchTournees();
  }, [periode, chauffeurFilter]);

  const fetchInitialData = async () => {
    try {
      const [chauffeursResult, produitsResult] = await Promise.all([
        usersService.listChauffeurs(),
        produitsService.list({ limit: 100 }),
      ]);
      setChauffeurs(chauffeursResult);
      setProduits(produitsResult.data);
    } catch (err) {
      console.error('Erreur chargement données:', err);
    }
  };

  const fetchTournees = async () => {
    setIsLoading(true);
    try {
      const endDate = new Date();
      let startDate: Date;

      if (periode === 'week') {
        startDate = startOfWeek(new Date(), { weekStartsOn: 1 });
      } else if (periode === 'month') {
        startDate = startOfMonth(new Date());
      } else {
        startDate = subDays(new Date(), parseInt(periode));
      }

      const result = await tourneesService.list({ limit: 1000, includePoints: true });

      let filtered = result.data.filter((t) => {
        const tourneeDate = parseISO(t.date);
        return tourneeDate >= startDate && tourneeDate <= endDate;
      });

      if (chauffeurFilter) {
        filtered = filtered.filter((t) => t.chauffeurId === chauffeurFilter);
      }

      setTournees(filtered);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Calcul des statistiques globales
  const globalStats = useMemo((): GlobalStats => {
    let totalPoints = 0;
    let pointsLivraison = 0;
    let pointsRamassage = 0;
    let pointsTermines = 0;
    let pointsIncidents = 0;
    let pointsPonctuels = 0;
    let pointsAvecCreneau = 0;
    let distanceTotale = 0;
    let dureeTotale = 0;
    let carburantEstime = 0;

    const tourneesTerminees = tournees.filter(t => t.statut === 'terminee').length;

    tournees.forEach((t) => {
      distanceTotale += t.distanceTotaleKm || 0;
      dureeTotale += t.dureeTotaleMin || 0;

      // Calcul carburant si le véhicule a une consommation définie
      if (t.vehicule?.consommationL100km && t.distanceTotaleKm) {
        carburantEstime += (t.distanceTotaleKm * t.vehicule.consommationL100km) / 100;
      }

      if (t.points) {
        t.points.forEach((p) => {
          totalPoints++;
          if (p.type === 'livraison') pointsLivraison++;
          else if (p.type === 'ramassage') pointsRamassage++;
          else { pointsLivraison++; pointsRamassage++; }

          if (p.statut === 'termine') pointsTermines++;
          if (p.statut === 'incident') pointsIncidents++;

          // Calcul ponctualité (arrivée dans le créneau)
          if (p.creneauDebut && p.heureArriveeEstimee) {
            pointsAvecCreneau++;
            const creneauDebut = new Date(p.creneauDebut);
            const arrivee = new Date(p.heureArriveeEstimee);
            // Considéré ponctuel si arrivée <= créneau fin ou <= créneau début + 30min si pas de fin
            const creneauFin = p.creneauFin ? new Date(p.creneauFin) : new Date(creneauDebut.getTime() + 30 * 60 * 1000);
            if (arrivee <= creneauFin) {
              pointsPonctuels++;
            }
          }
        });
      } else {
        totalPoints += t.nombrePoints || 0;
      }
    });

    const tauxPonctualite = pointsAvecCreneau > 0 ? (pointsPonctuels / pointsAvecCreneau) * 100 : 100;

    return {
      totalTournees: tournees.length,
      tourneesTerminees,
      totalPoints,
      pointsLivraison,
      pointsRamassage,
      pointsTermines,
      pointsIncidents,
      distanceTotale,
      dureeTotale,
      carburantEstime,
      coutCarburant: carburantEstime * FUEL_PRICE_PER_LITER,
      tauxPonctualite,
    };
  }, [tournees]);

  // Statistiques par chauffeur
  const chauffeurStats = useMemo((): ChauffeurStats[] => {
    const map = new Map<string, ChauffeurStats>();

    tournees.forEach((t) => {
      if (!t.chauffeurId || !t.chauffeur) return;

      const existing = map.get(t.chauffeurId) || {
        id: t.chauffeurId,
        nom: t.chauffeur.nom,
        prenom: t.chauffeur.prenom,
        couleur: t.chauffeur.couleur || COLORS.primary,
        vehicule: t.vehicule?.nom,
        consommationL100km: t.vehicule?.consommationL100km,
        tournees: 0,
        points: 0,
        distance: 0,
        carburant: 0,
        incidents: 0,
        tauxPonctualite: 0,
        _pointsPonctuels: 0,
        _pointsAvecCreneau: 0,
      } as ChauffeurStats & { _pointsPonctuels: number; _pointsAvecCreneau: number };

      existing.tournees++;
      existing.distance += t.distanceTotaleKm || 0;

      if (t.vehicule?.consommationL100km && t.distanceTotaleKm) {
        existing.carburant += (t.distanceTotaleKm * t.vehicule.consommationL100km) / 100;
      }

      if (t.points) {
        existing.points += t.points.length;
        existing.incidents += t.points.filter(p => p.statut === 'incident').length;

        t.points.forEach(p => {
          if (p.creneauDebut && p.heureArriveeEstimee) {
            (existing as any)._pointsAvecCreneau++;
            const creneauFin = p.creneauFin ? new Date(p.creneauFin) : new Date(new Date(p.creneauDebut).getTime() + 30 * 60 * 1000);
            if (new Date(p.heureArriveeEstimee) <= creneauFin) {
              (existing as any)._pointsPonctuels++;
            }
          }
        });
      } else {
        existing.points += t.nombrePoints || 0;
      }

      map.set(t.chauffeurId, existing);
    });

    // Calcul du taux de ponctualité final
    return Array.from(map.values()).map(cs => ({
      ...cs,
      tauxPonctualite: (cs as any)._pointsAvecCreneau > 0
        ? ((cs as any)._pointsPonctuels / (cs as any)._pointsAvecCreneau) * 100
        : 100,
    })).sort((a, b) => b.points - a.points);
  }, [tournees]);

  // Statistiques par produit
  const produitStats = useMemo((): ProduitStats[] => {
    const map = new Map<string, ProduitStats>();

    // Initialiser avec tous les produits
    produits.forEach(p => {
      map.set(p.id, {
        id: p.id,
        nom: p.nom,
        couleur: p.couleur || COLORS.primary,
        count: 0,
        livraisons: 0,
        ramassages: 0,
      });
    });

    tournees.forEach((t) => {
      if (!t.points) return;

      t.points.forEach((point) => {
        if (!point.produits) return;

        point.produits.forEach((pp: any) => {
          const produit = pp.produit;
          if (!produit) return;

          const existing = map.get(produit.id);
          if (existing) {
            existing.count += pp.quantite || 1;
            if (point.type === 'livraison') existing.livraisons += pp.quantite || 1;
            else if (point.type === 'ramassage') existing.ramassages += pp.quantite || 1;
            else {
              existing.livraisons += pp.quantite || 1;
              existing.ramassages += pp.quantite || 1;
            }
          }
        });
      });
    });

    return Array.from(map.values()).filter(p => p.count > 0).sort((a, b) => b.count - a.count);
  }, [tournees, produits]);

  // Données quotidiennes pour le graphique
  const dailyData = useMemo((): DailyData[] => {
    const map = new Map<string, DailyData>();

    // Déterminer la plage de dates
    const endDate = new Date();
    let startDate: Date;
    if (periode === 'week') {
      startDate = startOfWeek(new Date(), { weekStartsOn: 1 });
    } else if (periode === 'month') {
      startDate = startOfMonth(new Date());
    } else {
      startDate = subDays(new Date(), parseInt(periode));
    }

    // Initialiser tous les jours
    let current = new Date(startDate);
    while (current <= endDate) {
      const key = format(current, 'yyyy-MM-dd');
      map.set(key, {
        date: key,
        dateLabel: format(current, 'dd/MM', { locale: fr }),
        points: 0,
        distance: 0,
        livraisons: 0,
        ramassages: 0,
      });
      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }

    // Remplir avec les données
    tournees.forEach((t) => {
      // Parse ISO date correctly
      const tourneeDate = parseISO(t.date);
      const key = format(tourneeDate, 'yyyy-MM-dd');
      const existing = map.get(key);
      if (existing) {
        existing.distance += t.distanceTotaleKm || 0;
        if (t.points) {
          t.points.forEach(p => {
            existing.points++;
            if (p.type === 'livraison') existing.livraisons++;
            else if (p.type === 'ramassage') existing.ramassages++;
            else { existing.livraisons++; existing.ramassages++; }
          });
        } else {
          existing.points += t.nombrePoints || 0;
        }
      }
    });

    return Array.from(map.values());
  }, [tournees, periode]);

  // Données pour le pie chart des types
  const typesPieData = useMemo(() => [
    { name: 'Livraisons', value: globalStats.pointsLivraison, color: COLORS.primary },
    { name: 'Ramassages', value: globalStats.pointsRamassage, color: COLORS.success },
  ].filter(d => d.value > 0), [globalStats]);

  // Export CSV
  const exportCSV = () => {
    const headers = ['Date', 'Chauffeur', 'Véhicule', 'Statut', 'Points', 'Distance (km)', 'Carburant (L)', 'Coût carburant (€)'];
    const rows = tournees.map((t) => {
      const carburant = t.vehicule?.consommationL100km && t.distanceTotaleKm
        ? ((t.distanceTotaleKm * t.vehicule.consommationL100km) / 100).toFixed(1)
        : '-';
      const cout = carburant !== '-' ? (parseFloat(carburant) * FUEL_PRICE_PER_LITER).toFixed(2) : '-';

      return [
        format(parseISO(t.date), 'dd/MM/yyyy'),
        t.chauffeur ? `${t.chauffeur.prenom} ${t.chauffeur.nom}` : '-',
        t.vehicule?.nom || '-',
        t.statut,
        t.nombrePoints || 0,
        t.distanceTotaleKm?.toFixed(1) || 0,
        carburant,
        cout,
      ];
    });

    const csv = [headers, ...rows].map((row) => row.join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport-optitour-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
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
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-gray-500">Vue d'ensemble de l'activité</p>
        </div>
        <Button variant="secondary" onClick={exportCSV}>
          <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
          Exporter
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <Select
          value={periode}
          onChange={(e) => setPeriode(e.target.value)}
          options={[
            { value: 'week', label: 'Cette semaine' },
            { value: '7', label: '7 derniers jours' },
            { value: '30', label: '30 derniers jours' },
            { value: 'month', label: 'Ce mois-ci' },
            { value: '90', label: '3 derniers mois' },
          ]}
          className="w-44"
        />
        <Select
          value={chauffeurFilter}
          onChange={(e) => setChauffeurFilter(e.target.value)}
          options={[
            { value: '', label: 'Tous les chauffeurs' },
            ...chauffeurs.map((c) => ({
              value: c.id,
              label: `${c.prenom} ${c.nom}`,
            })),
          ]}
          className="w-52"
        />
      </div>

      {/* KPI Cards - Row 1: Activité */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-blue-50 to-white border-blue-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-blue-700">{globalStats.totalPoints}</p>
              <p className="text-sm text-blue-600 font-medium">Points traités</p>
            </div>
            <div className="p-2 bg-blue-100 rounded-lg">
              <MapPinIcon className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <div className="mt-2 flex gap-3 text-xs text-blue-500">
            <span>{globalStats.pointsLivraison} liv.</span>
            <span>{globalStats.pointsRamassage} ram.</span>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-green-50 to-white border-green-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-green-700">{globalStats.tourneesTerminees}</p>
              <p className="text-sm text-green-600 font-medium">Tournées terminées</p>
            </div>
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircleIcon className="h-6 w-6 text-green-600" />
            </div>
          </div>
          <div className="mt-2 text-xs text-green-500">
            sur {globalStats.totalTournees} tournées
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-purple-50 to-white border-purple-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-purple-700">{globalStats.distanceTotale.toFixed(0)}</p>
              <p className="text-sm text-purple-600 font-medium">km parcourus</p>
            </div>
            <div className="p-2 bg-purple-100 rounded-lg">
              <TruckIcon className="h-6 w-6 text-purple-600" />
            </div>
          </div>
          <div className="mt-2 text-xs text-purple-500">
            {Math.floor(globalStats.dureeTotale / 60)}h sur la route
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-amber-50 to-white border-amber-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-amber-700">{globalStats.carburantEstime.toFixed(0)} L</p>
              <p className="text-sm text-amber-600 font-medium">Carburant</p>
            </div>
            <div className="p-2 bg-amber-100 rounded-lg">
              <BoltIcon className="h-6 w-6 text-amber-600" />
            </div>
          </div>
          <div className="mt-2 text-xs text-amber-500">
            ≈ {globalStats.coutCarburant.toFixed(0)} € ({FUEL_PRICE_PER_LITER}€/L)
          </div>
        </Card>
      </div>

      {/* KPI Cards - Row 2: Qualité */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={clsx(
              "p-3 rounded-full",
              globalStats.tauxPonctualite >= 90 ? "bg-green-100" : globalStats.tauxPonctualite >= 70 ? "bg-amber-100" : "bg-red-100"
            )}>
              <ClockIcon className={clsx(
                "h-6 w-6",
                globalStats.tauxPonctualite >= 90 ? "text-green-600" : globalStats.tauxPonctualite >= 70 ? "text-amber-600" : "text-red-600"
              )} />
            </div>
            <div>
              <p className="text-2xl font-bold">{globalStats.tauxPonctualite.toFixed(0)}%</p>
              <p className="text-sm text-gray-500">Ponctualité</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={clsx(
              "p-3 rounded-full",
              globalStats.pointsIncidents === 0 ? "bg-green-100" : "bg-red-100"
            )}>
              <ExclamationTriangleIcon className={clsx(
                "h-6 w-6",
                globalStats.pointsIncidents === 0 ? "text-green-600" : "text-red-600"
              )} />
            </div>
            <div>
              <p className="text-2xl font-bold">{globalStats.pointsIncidents}</p>
              <p className="text-sm text-gray-500">Incidents</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-full">
              <CalendarDaysIcon className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {globalStats.totalTournees > 0 ? (globalStats.totalPoints / globalStats.totalTournees).toFixed(1) : 0}
              </p>
              <p className="text-sm text-gray-500">Points / tournée</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activité quotidienne - Area Chart */}
        <Card className="p-4 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 mb-4">Activité quotidienne</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <defs>
                  <linearGradient id="colorLiv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={COLORS.success} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="dateLabel" fontSize={11} stroke="#9CA3AF" />
                <YAxis fontSize={11} stroke="#9CA3AF" />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #E5E7EB' }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Area
                  type="monotone"
                  dataKey="livraisons"
                  name="Livraisons"
                  stroke={COLORS.primary}
                  fill="url(#colorLiv)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="ramassages"
                  name="Ramassages"
                  stroke={COLORS.success}
                  fill="url(#colorRam)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Répartition liv/ram - Pie Chart */}
        <Card className="p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Répartition</h3>
          <div className="h-64 flex flex-col items-center justify-center">
            {typesPieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="80%">
                  <PieChart>
                    <Pie
                      data={typesPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {typesPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 text-sm">
                  {typesPieData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-gray-600">{entry.name}: {entry.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-gray-400">Aucune donnée</p>
            )}
          </div>
        </Card>
      </div>

      {/* Chauffeurs Performance */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserGroupIcon className="h-5 w-5 text-gray-400" />
            Performance chauffeurs
          </h3>
        </div>

        {chauffeurStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-3 font-medium">Chauffeur</th>
                  <th className="pb-3 font-medium text-center">Tournées</th>
                  <th className="pb-3 font-medium text-center">Points</th>
                  <th className="pb-3 font-medium text-center">Distance</th>
                  <th className="pb-3 font-medium text-center">Carburant</th>
                  <th className="pb-3 font-medium text-center">Ponctualité</th>
                  <th className="pb-3 font-medium text-center">Incidents</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {chauffeurStats.map((cs) => (
                  <tr key={cs.id} className="hover:bg-gray-50">
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: cs.couleur }}
                        />
                        <div>
                          <p className="font-medium text-gray-900">{cs.prenom} {cs.nom}</p>
                          {cs.vehicule && (
                            <p className="text-xs text-gray-400">{cs.vehicule}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-center font-medium">{cs.tournees}</td>
                    <td className="py-3 text-center">{cs.points}</td>
                    <td className="py-3 text-center">{cs.distance.toFixed(0)} km</td>
                    <td className="py-3 text-center">
                      {cs.carburant > 0 ? `${cs.carburant.toFixed(0)} L` : '-'}
                    </td>
                    <td className="py-3 text-center">
                      <span className={clsx(
                        "px-2 py-0.5 rounded-full text-xs font-medium",
                        cs.tauxPonctualite >= 90 ? "bg-green-100 text-green-700" :
                        cs.tauxPonctualite >= 70 ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-700"
                      )}>
                        {cs.tauxPonctualite.toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      {cs.incidents > 0 ? (
                        <span className="text-red-600 font-medium">{cs.incidents}</span>
                      ) : (
                        <span className="text-green-600">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">Aucune donnée pour cette période</p>
        )}
      </Card>

      {/* Produits utilisés */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <CubeIcon className="h-5 w-5 text-gray-400" />
            Produits les plus utilisés
          </h3>
        </div>

        {produitStats.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Bar Chart */}
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={produitStats.slice(0, 6)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis type="number" fontSize={11} stroke="#9CA3AF" />
                  <YAxis dataKey="nom" type="category" fontSize={11} stroke="#9CA3AF" width={80} />
                  <Tooltip />
                  <Bar dataKey="count" name="Utilisations" radius={[0, 4, 4, 0]}>
                    {produitStats.slice(0, 6).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.couleur || CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Liste détaillée */}
            <div className="space-y-3">
              {produitStats.slice(0, 6).map((ps, index) => (
                <div key={ps.id} className="flex items-center gap-3">
                  <div className="w-6 text-center text-sm font-bold text-gray-400">
                    #{index + 1}
                  </div>
                  <div
                    className="w-4 h-4 rounded flex-shrink-0"
                    style={{ backgroundColor: ps.couleur }}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{ps.nom}</p>
                    <p className="text-xs text-gray-400">
                      {ps.livraisons} liv. · {ps.ramassages} ram.
                    </p>
                  </div>
                  <div className="text-lg font-bold text-gray-700">
                    {ps.count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">Aucune donnée pour cette période</p>
        )}
      </Card>
    </div>
  );
}

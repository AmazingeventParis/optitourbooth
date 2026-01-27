import { useState, useEffect } from 'react';
import { Card, Select, Button } from '@/components/ui';
import { tourneesService } from '@/services/tournees.service';
import { usersService } from '@/services/users.service';
import { useToast } from '@/hooks/useToast';
import { Tournee, User } from '@/types';
import { format, subDays, startOfMonth, parseISO } from 'date-fns';
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
  LineChart,
  Line,
  Legend,
} from 'recharts';
import {
  CalendarIcon,
  MapPinIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

interface Stats {
  totalTournees: number;
  tourneesTerminees: number;
  tourneesAnnulees: number;
  totalPoints: number;
  pointsTermines: number;
  pointsIncidents: number;
  distanceTotale: number;
  dureeTotale: number;
}

interface DailyStats {
  date: string;
  tournees: number;
  points: number;
  distance: number;
}

interface ChauffeurStats {
  chauffeurId: string;
  chauffeurNom: string;
  tournees: number;
  points: number;
  distance: number;
  incidents: number;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function RapportsPage() {
  const { error: showError } = useToast();

  const [chauffeurs, setChauffeurs] = useState<User[]>([]);
  const [tournees, setTournees] = useState<Tournee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [periode, setPeriode] = useState('30');
  const [chauffeurFilter, setChauffeurFilter] = useState('');

  // Computed stats
  const [stats, setStats] = useState<Stats>({
    totalTournees: 0,
    tourneesTerminees: 0,
    tourneesAnnulees: 0,
    totalPoints: 0,
    pointsTermines: 0,
    pointsIncidents: 0,
    distanceTotale: 0,
    dureeTotale: 0,
  });
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [chauffeurStats, setChauffeurStats] = useState<ChauffeurStats[]>([]);

  useEffect(() => {
    fetchChauffeurs();
  }, []);

  useEffect(() => {
    fetchData();
  }, [periode, chauffeurFilter]);

  const fetchChauffeurs = async () => {
    try {
      const result = await usersService.listChauffeurs();
      setChauffeurs(result);
    } catch (err) {
      console.error('Erreur chargement chauffeurs:', err);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Calculate date range
      const endDate = new Date();
      let startDate: Date;

      if (periode === 'month') {
        startDate = startOfMonth(new Date());
      } else {
        startDate = subDays(new Date(), parseInt(periode));
      }

      // Fetch all tournees for the period
      const result = await tourneesService.list({
        limit: 1000,
      });

      // Filter by date range and chauffeur
      let filtered = result.data.filter((t) => {
        const tourneeDate = parseISO(t.date);
        return tourneeDate >= startDate && tourneeDate <= endDate;
      });

      if (chauffeurFilter) {
        filtered = filtered.filter((t) => t.chauffeurId === chauffeurFilter);
      }

      setTournees(filtered);

      // Calculate stats
      calculateStats(filtered);
      calculateDailyStats(filtered, startDate, endDate);
      calculateChauffeurStats(filtered);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (data: Tournee[]) => {
    const newStats: Stats = {
      totalTournees: data.length,
      tourneesTerminees: data.filter((t) => t.statut === 'terminee').length,
      tourneesAnnulees: data.filter((t) => t.statut === 'annulee').length,
      totalPoints: 0,
      pointsTermines: 0,
      pointsIncidents: 0,
      distanceTotale: 0,
      dureeTotale: 0,
    };

    data.forEach((t) => {
      newStats.totalPoints += t.nombrePoints || 0;
      newStats.distanceTotale += t.distanceTotaleKm || 0;
      newStats.dureeTotale += t.dureeTotaleMin || 0;

      if (t.points) {
        newStats.pointsTermines += t.points.filter((p) => p.statut === 'termine').length;
        newStats.pointsIncidents += t.points.filter((p) => p.statut === 'incident').length;
      }
    });

    setStats(newStats);
  };

  const calculateDailyStats = (data: Tournee[], startDate: Date, endDate: Date) => {
    const dailyMap = new Map<string, DailyStats>();

    // Initialize all days
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateKey = format(currentDate, 'yyyy-MM-dd');
      dailyMap.set(dateKey, {
        date: format(currentDate, 'dd/MM', { locale: fr }),
        tournees: 0,
        points: 0,
        distance: 0,
      });
      currentDate = new Date(currentDate.setDate(currentDate.getDate() + 1));
    }

    // Fill with data
    data.forEach((t) => {
      const dateKey = t.date.split('T')[0];
      const existing = dailyMap.get(dateKey);
      if (existing) {
        existing.tournees += 1;
        existing.points += t.nombrePoints || 0;
        existing.distance += t.distanceTotaleKm || 0;
      }
    });

    setDailyStats(Array.from(dailyMap.values()));
  };

  const calculateChauffeurStats = (data: Tournee[]) => {
    const chauffeurMap = new Map<string, ChauffeurStats>();

    data.forEach((t) => {
      if (!t.chauffeurId) return;

      const existing = chauffeurMap.get(t.chauffeurId) || {
        chauffeurId: t.chauffeurId,
        chauffeurNom: t.chauffeur ? `${t.chauffeur.prenom} ${t.chauffeur.nom}` : 'Inconnu',
        tournees: 0,
        points: 0,
        distance: 0,
        incidents: 0,
      };

      existing.tournees += 1;
      existing.points += t.nombrePoints || 0;
      existing.distance += t.distanceTotaleKm || 0;

      if (t.points) {
        existing.incidents += t.points.filter((p) => p.statut === 'incident').length;
      }

      chauffeurMap.set(t.chauffeurId, existing);
    });

    setChauffeurStats(Array.from(chauffeurMap.values()));
  };

  const exportCSV = () => {
    const headers = ['Date', 'Chauffeur', 'Statut', 'Points', 'Distance (km)', 'Durée (min)'];
    const rows = tournees.map((t) => [
      format(parseISO(t.date), 'dd/MM/yyyy'),
      t.chauffeur ? `${t.chauffeur.prenom} ${t.chauffeur.nom}` : '-',
      t.statut,
      t.nombrePoints || 0,
      t.distanceTotaleKm?.toFixed(1) || 0,
      t.dureeTotaleMin || 0,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport-tournees-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const statutPieData = [
    { name: 'Terminées', value: stats.tourneesTerminees },
    { name: 'En cours', value: stats.totalTournees - stats.tourneesTerminees - stats.tourneesAnnulees },
    { name: 'Annulées', value: stats.tourneesAnnulees },
  ].filter((d) => d.value > 0);

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
          <h1 className="text-2xl font-bold text-gray-900">Rapports</h1>
          <p className="text-gray-500">Statistiques et analyses des tournées</p>
        </div>
        <Button variant="secondary" onClick={exportCSV}>
          <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
          Exporter CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-4 flex-wrap">
          <div className="w-48">
            <Select
              label="Période"
              value={periode}
              onChange={(e) => setPeriode(e.target.value)}
              options={[
                { value: '7', label: '7 derniers jours' },
                { value: '30', label: '30 derniers jours' },
                { value: '90', label: '90 derniers jours' },
                { value: 'month', label: 'Ce mois-ci' },
              ]}
            />
          </div>
          <div className="w-48">
            <Select
              label="Chauffeur"
              value={chauffeurFilter}
              onChange={(e) => setChauffeurFilter(e.target.value)}
              options={[
                { value: '', label: 'Tous les chauffeurs' },
                ...chauffeurs.map((c) => ({
                  value: c.id,
                  label: `${c.prenom} ${c.nom}`,
                })),
              ]}
            />
          </div>
        </div>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <CalendarIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalTournees}</p>
              <p className="text-sm text-gray-500">Tournées</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircleIcon className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.tourneesTerminees}</p>
              <p className="text-sm text-gray-500">Terminées</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              <MapPinIcon className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.distanceTotale.toFixed(0)}</p>
              <p className="text-sm text-gray-500">km parcourus</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.pointsIncidents}</p>
              <p className="text-sm text-gray-500">Incidents</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Activity Chart */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4">Activité quotidienne</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="tournees"
                  name="Tournées"
                  stroke="#3B82F6"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="points"
                  name="Points"
                  stroke="#10B981"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Status Pie Chart */}
        <Card className="p-4">
          <h3 className="font-semibold mb-4">Répartition des statuts</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statutPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {statutPieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Chauffeur Performance */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Performance par chauffeur</h3>
        {chauffeurStats.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chauffeurStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={12} />
                <YAxis dataKey="chauffeurNom" type="category" fontSize={12} width={100} />
                <Tooltip />
                <Legend />
                <Bar dataKey="tournees" name="Tournées" fill="#3B82F6" />
                <Bar dataKey="points" name="Points" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">Aucune donnée disponible</p>
        )}
      </Card>

      {/* Detailed Stats Table */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Statistiques détaillées par chauffeur</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4">Chauffeur</th>
                <th className="text-right py-3 px-4">Tournées</th>
                <th className="text-right py-3 px-4">Points</th>
                <th className="text-right py-3 px-4">Distance (km)</th>
                <th className="text-right py-3 px-4">Incidents</th>
                <th className="text-right py-3 px-4">Moy. points/tournée</th>
              </tr>
            </thead>
            <tbody>
              {chauffeurStats.map((cs) => (
                <tr key={cs.chauffeurId} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium">{cs.chauffeurNom}</td>
                  <td className="text-right py-3 px-4">{cs.tournees}</td>
                  <td className="text-right py-3 px-4">{cs.points}</td>
                  <td className="text-right py-3 px-4">{cs.distance.toFixed(1)}</td>
                  <td className="text-right py-3 px-4">
                    <span className={cs.incidents > 0 ? 'text-red-600 font-medium' : ''}>
                      {cs.incidents}
                    </span>
                  </td>
                  <td className="text-right py-3 px-4">
                    {cs.tournees > 0 ? (cs.points / cs.tournees).toFixed(1) : '-'}
                  </td>
                </tr>
              ))}
              {chauffeurStats.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    Aucune donnée disponible
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

import { useState, useEffect, useCallback, ChangeEvent } from 'react';
import { bookingsService, Booking, BookingDetail, BookingStats } from '@/services/bookings.service';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

const STATUS_LABELS: Record<string, string> = {
  link_sent: 'Lien envoyé',
  page_viewed: 'Page vue',
  review_clicked: 'Avis cliqué',
  no_review_selected: 'Sans avis',
  review_detected: 'Avis détecté',
  review_matched: 'Avis matché',
  gallery_scheduled_24h: 'Galerie planifiée',
  gallery_sent: 'Galerie envoyée',
  manual_check_required: 'Vérif. manuelle',
  closed: 'Fermé',
};

const STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  link_sent: 'default',
  page_viewed: 'info',
  review_clicked: 'warning',
  no_review_selected: 'default',
  review_detected: 'info',
  review_matched: 'success',
  gallery_scheduled_24h: 'warning',
  gallery_sent: 'success',
  manual_check_required: 'danger',
  closed: 'default',
};

const EVENT_LABELS: Record<string, string> = {
  landing_view: 'Page consultée',
  review_click: 'Clic avis Google',
  no_review_click: 'Clic sans avis',
  review_redirected: 'Redirection Google',
  review_detected: 'Avis détecté',
  gallery_send_scheduled: 'Envoi planifié',
  gallery_sent: 'Galerie envoyée',
  matching_failed: 'Matching échoué',
  manual_review_required: 'Vérification requise',
};

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingDetail | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Create form
  const [createForm, setCreateForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    eventDate: '',
    galleryUrl: '',
    googleReviewUrl: '',
  });

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bookingsService.list({ page, limit: 20, status: statusFilter || undefined, search: search || undefined });
      setBookings(res.data);
      if (res.meta) setTotalPages(res.meta.totalPages);
    } catch {
      toast.error('Erreur chargement des réservations');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  const loadStats = useCallback(async () => {
    try {
      const s = await bookingsService.getStats();
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadBookings();
    loadStats();
  }, [loadBookings, loadStats]);

  const handleCreate = async () => {
    if (!createForm.customerName || !createForm.eventDate) {
      toast.error('Nom et date requis');
      return;
    }
    try {
      const booking = await bookingsService.create({
        customerName: createForm.customerName,
        customerEmail: createForm.customerEmail || undefined,
        customerPhone: createForm.customerPhone || undefined,
        eventDate: createForm.eventDate,
        galleryUrl: createForm.galleryUrl || undefined,
        googleReviewUrl: createForm.googleReviewUrl || undefined,
      });
      toast.success('Réservation créée');
      setShowCreateModal(false);
      setCreateForm({ customerName: '', customerEmail: '', customerPhone: '', eventDate: '', galleryUrl: '', googleReviewUrl: '' });
      loadBookings();
      loadStats();

      // Show the public URL
      if (booking.publicUrl) {
        toast.success(`Lien public : ${booking.publicUrl}`, { duration: 10000 });
      }
    } catch {
      toast.error('Erreur lors de la création');
    }
  };

  const handleViewDetail = async (id: string) => {
    try {
      const detail = await bookingsService.getById(id);
      setSelectedBooking(detail);
      setShowDetailModal(true);
    } catch {
      toast.error('Erreur chargement détails');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await bookingsService.delete(deleteId);
      toast.success('Réservation supprimée');
      setDeleteId(null);
      loadBookings();
      loadStats();
    } catch {
      toast.error('Erreur suppression');
    }
  };

  const handleSendGallery = async (id: string) => {
    try {
      await bookingsService.sendGallery(id);
      toast.success('Envoi de galerie déclenché');
      if (selectedBooking?.id === id) {
        handleViewDetail(id);
      }
      loadBookings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur envoi galerie');
    }
  };

  const handleMatchAction = async (matchId: string, status: 'matched' | 'rejected') => {
    try {
      await bookingsService.updateMatchStatus(matchId, status);
      toast.success(status === 'matched' ? 'Match validé' : 'Match rejeté');
      if (selectedBooking) {
        handleViewDetail(selectedBooking.id);
      }
      loadBookings();
    } catch {
      toast.error('Erreur mise à jour match');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copié !');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Réservations & Avis</h1>
          <p className="text-gray-500">Gestion des liens de collecte d'avis et envoi de galeries</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          + Nouvelle réservation
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-gray-500">Galeries envoyées</p>
            <p className="text-2xl font-bold text-green-600">{stats.byStatus.gallery_sent || 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-gray-500">Avis matchés</p>
            <p className="text-2xl font-bold text-purple-600">{stats.byStatus.review_matched || 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-gray-500">Vérif. manuelle</p>
            <p className="text-2xl font-bold text-red-600">{stats.byStatus.manual_check_required || 0}</p>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Rechercher par nom, email ou token..."
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1"
          />
          <select
            value={statusFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Chargement...</div>
        ) : bookings.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Aucune réservation trouvée</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date événement</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Événements</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{b.customerName}</div>
                      <div className="text-sm text-gray-500">{b.customerEmail || b.customerPhone || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(b.eventDate).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANTS[b.status] || 'default'}>
                        {STATUS_LABELS[b.status] || b.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {b._count?.events || 0} events / {b._count?.reviewMatches || 0} matchs
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <Button variant="secondary" size="sm" onClick={() => handleViewDetail(b.id)}>
                        Détails
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyToClipboard(`${window.location.origin}/galerie/${b.publicToken}`)}
                      >
                        Copier lien
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleteId(b.id)}>
                        Suppr.
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Précédent
            </Button>
            <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Suivant
            </Button>
          </div>
        )}
      </Card>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nouvelle réservation"
      >
        <div className="space-y-4">
          <Input
            label="Nom du client *"
            value={createForm.customerName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, customerName: e.target.value })}
            placeholder="Jean Dupont"
          />
          <Input
            label="Email"
            type="email"
            value={createForm.customerEmail}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, customerEmail: e.target.value })}
            placeholder="client@email.com"
          />
          <Input
            label="Téléphone"
            value={createForm.customerPhone}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, customerPhone: e.target.value })}
            placeholder="06 12 34 56 78"
          />
          <Input
            label="Date de l'événement *"
            type="date"
            value={createForm.eventDate}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, eventDate: e.target.value })}
          />
          <Input
            label="URL de la galerie"
            value={createForm.galleryUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, galleryUrl: e.target.value })}
            placeholder="https://galerie.example.com/..."
          />
          <Input
            label="URL avis Google"
            value={createForm.googleReviewUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateForm({ ...createForm, googleReviewUrl: e.target.value })}
            placeholder="https://g.page/r/..."
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Annuler</Button>
            <Button onClick={handleCreate}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={selectedBooking ? `Réservation - ${selectedBooking.customerName}` : 'Détails'}
        size="lg"
      >
        {selectedBooking && (
          <div className="space-y-6">
            {/* Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Client</p>
                <p className="font-medium">{selectedBooking.customerName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Statut</p>
                <Badge variant={STATUS_VARIANTS[selectedBooking.status] || 'default'}>
                  {STATUS_LABELS[selectedBooking.status] || selectedBooking.status}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-gray-500">Email</p>
                <p className="text-sm">{selectedBooking.customerEmail || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Téléphone</p>
                <p className="text-sm">{selectedBooking.customerPhone || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Date événement</p>
                <p className="text-sm">{new Date(selectedBooking.eventDate).toLocaleDateString('fr-FR')}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Galerie</p>
                <p className="text-sm truncate">{selectedBooking.galleryUrl || 'Non configurée'}</p>
              </div>
            </div>

            {/* Public URL */}
            {selectedBooking.publicUrl && (
              <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between">
                <code className="text-sm text-gray-700 truncate flex-1">{selectedBooking.publicUrl}</code>
                <Button variant="secondary" size="sm" onClick={() => copyToClipboard(selectedBooking.publicUrl!)}>
                  Copier
                </Button>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleSendGallery(selectedBooking.id)}
                disabled={!selectedBooking.galleryUrl || selectedBooking.status === 'gallery_sent'}
              >
                Envoyer galerie maintenant
              </Button>
            </div>

            {/* Review Matches */}
            {selectedBooking.reviewMatches.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Correspondances avis</h3>
                <div className="space-y-3">
                  {selectedBooking.reviewMatches.map((match) => (
                    <div key={match.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">{match.googleReviewerDisplayName || 'Anonyme'}</span>
                          <span className="text-sm text-gray-500 ml-2">Score: {match.matchScore}</span>
                        </div>
                        <Badge variant={match.matchStatus === 'matched' ? 'success' : match.matchStatus === 'rejected' ? 'danger' : 'warning'}>
                          {match.matchStatus}
                        </Badge>
                      </div>
                      {match.googleReviewCreateTime && (
                        <p className="text-xs text-gray-500 mt-1">
                          Avis posté le {new Date(match.googleReviewCreateTime).toLocaleString('fr-FR')}
                        </p>
                      )}
                      {match.matchStatus === 'manual_check' && (
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" onClick={() => handleMatchAction(match.id, 'matched')}>
                            Valider
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleMatchAction(match.id, 'rejected')}>
                            Rejeter
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gallery Dispatches */}
            {selectedBooking.galleryDispatches.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Envois de galerie</h3>
                <div className="space-y-2">
                  {selectedBooking.galleryDispatches.map((dispatch) => (
                    <div key={dispatch.id} className="flex items-center justify-between text-sm border rounded-lg p-2">
                      <div>
                        <span className="font-medium">{dispatch.dispatchType}</span>
                        <span className="text-gray-500 ml-2">
                          Planifié : {new Date(dispatch.scheduledFor).toLocaleString('fr-FR')}
                        </span>
                      </div>
                      <Badge variant={dispatch.deliveryStatus === 'sent' || dispatch.deliveryStatus === 'delivered' ? 'success' : dispatch.deliveryStatus === 'failed' ? 'danger' : 'warning'}>
                        {dispatch.deliveryStatus}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Events timeline */}
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Historique</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {selectedBooking.events.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 text-sm">
                    <span className="text-gray-400 whitespace-nowrap">
                      {new Date(event.occurredAt).toLocaleString('fr-FR')}
                    </span>
                    <span className="font-medium text-gray-700">
                      {EVENT_LABELS[event.eventType] || event.eventType}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Supprimer la réservation"
        message="Êtes-vous sûr de vouloir supprimer cette réservation ? Cette action est irréversible."
        confirmText="Supprimer"
        variant="danger"
      />
    </div>
  );
}

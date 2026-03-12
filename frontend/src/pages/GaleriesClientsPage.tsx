import { useState, useEffect, useCallback } from 'react';
import { bookingsService, CalendarEvent } from '@/services/bookings.service';
import { Card, Button, Badge, Modal, Input } from '@/components/ui';
import {
  PhotoIcon,
  PaperAirplaneIcon,
  ClipboardDocumentIcon,
  LinkIcon,
  CheckCircleIcon,
  CalendarDaysIcon,
  StarIcon,
  EyeIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  link_sent: { label: 'Lien envoyé', color: 'bg-blue-100 text-blue-800' },
  page_viewed: { label: 'Page vue', color: 'bg-indigo-100 text-indigo-800' },
  rated_low: { label: 'Note faible', color: 'bg-red-100 text-red-800' },
  rated_high: { label: 'Note haute', color: 'bg-green-100 text-green-800' },
  review_clicked: { label: 'Avis cliqué', color: 'bg-amber-100 text-amber-800' },
  no_review_selected: { label: 'Sans avis', color: 'bg-gray-100 text-gray-800' },
  review_detected: { label: 'Avis détecté', color: 'bg-green-100 text-green-800' },
  review_matched: { label: 'Avis validé', color: 'bg-green-100 text-green-800' },
  gallery_scheduled_24h: { label: 'Galerie H+24', color: 'bg-orange-100 text-orange-800' },
  gallery_sent: { label: 'Galerie envoyée', color: 'bg-emerald-100 text-emerald-800' },
  manual_check_required: { label: 'Vérification', color: 'bg-red-100 text-red-800' },
  closed: { label: 'Fermé', color: 'bg-gray-100 text-gray-600' },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const s = new Date(start + 'T12:00:00Z');
  const e = new Date(end + 'T12:00:00Z');
  return `${s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} → ${e.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default function GaleriesClientsPage() {
  const [events, setEvents] = useState<{ upcoming: CalendarEvent[]; past: CalendarEvent[] }>({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [search, setSearch] = useState('');

  // Send modal state
  const [sendModal, setSendModal] = useState<{ event: CalendarEvent; brand: 'SHOOTNBOX' | 'SMAKK' } | null>(null);
  const [sendEmail, setSendEmail] = useState('');
  const [sending, setSending] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await bookingsService.getCalendarEvents();
      setEvents(data);
    } catch {
      toast.error('Erreur lors du chargement des événements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleSend = async (ev: CalendarEvent, brand: 'SHOOTNBOX' | 'SMAKK', email: string) => {
    if (!email.trim()) {
      toast.error('Email requis');
      return;
    }

    setSending(true);
    try {
      let bookingId = ev.booking?.id;

      if (!bookingId) {
        const booking = await bookingsService.createFromEvent({
          googleEventId: ev.googleEventId,
          customerName: ev.clientName,
          customerEmail: email,
          eventDate: ev.startDate,
          eventEndDate: ev.endDate,
          produitNom: ev.produitNom || undefined,
        });
        bookingId = booking.id;
      }

      await bookingsService.sendLinkEmail(bookingId, email, brand);
      toast.success(`Lien envoyé à ${email} via ${brand}`);
      setSendModal(null);
      setSendEmail('');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  const handleBrandClick = (ev: CalendarEvent, brand: 'SHOOTNBOX' | 'SMAKK') => {
    const email = ev.booking?.customerEmail;
    if (email) {
      // Email already known, send directly
      handleSend(ev, brand, email);
    } else {
      // Ask for email
      setSendEmail('');
      setSendModal({ event: ev, brand });
    }
  };

  const handleCopyLink = async (ev: CalendarEvent) => {
    if (!ev.booking?.publicUrl) {
      try {
        const booking = await bookingsService.createFromEvent({
          googleEventId: ev.googleEventId,
          customerName: ev.clientName,
          eventDate: ev.startDate,
          eventEndDate: ev.endDate,
          produitNom: ev.produitNom || undefined,
        });
        await navigator.clipboard.writeText(booking.publicUrl);
        toast.success('Lien copié !');
        fetchEvents();
      } catch {
        toast.error('Erreur lors de la création du lien');
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(ev.booking.publicUrl);
      toast.success('Lien copié !');
    } catch {
      toast.error('Impossible de copier');
    }
  };

  const handleRename = async (ev: CalendarEvent, newName: string) => {
    if (!ev.booking?.id) return;
    try {
      await bookingsService.update(ev.booking.id, { customerName: newName } as any);
      toast.success('Nom mis à jour');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur');
    }
  };

  const filterBySearch = (list: CalendarEvent[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(ev => {
      const name = (ev.booking?.customerName || ev.clientName).toLowerCase();
      return name.includes(q);
    });
  };

  const filteredUpcoming = filterBySearch(events.upcoming);
  const filteredPast = filterBySearch(events.past);
  const currentEvents = tab === 'upcoming' ? filteredUpcoming : filteredPast;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Galeries Clients</h1>
          <p className="text-sm text-gray-500 mt-1">
            Envoyez les galeries photos et collectez les avis Google
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchEvents(); }}>
          <ArrowPathIcon className="h-4 w-4 mr-2" />
          Actualiser
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">{events.upcoming.length}</div>
          <div className="text-xs text-gray-500">A venir</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-gray-600">{events.past.length}</div>
          <div className="text-xs text-gray-500">Passés</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-green-600">
            {[...events.upcoming, ...events.past].filter(e => e.booking?.status === 'gallery_sent').length}
          </div>
          <div className="text-xs text-gray-500">Galeries envoyées</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">
            {[...events.upcoming, ...events.past].filter(e => e.booking?.status === 'review_matched' || e.booking?.status === 'review_detected').length}
          </div>
          <div className="text-xs text-gray-500">Avis collectés</div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un client..."
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab('upcoming')}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'upcoming' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          A venir ({filteredUpcoming.length})
        </button>
        <button
          onClick={() => setTab('past')}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'past' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Passés ({filteredPast.length})
        </button>
      </div>

      {/* Events List */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : currentEvents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <PhotoIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Aucun événement {tab === 'upcoming' ? 'à venir' : 'passé'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {currentEvents.map((ev) => (
            <EventCard
              key={ev.googleEventId}
              event={ev}
              onRename={(newName) => handleRename(ev, newName)}
              onBrandSend={(brand) => handleBrandClick(ev, brand)}
              onCopyLink={() => handleCopyLink(ev)}
              sending={sending}
            />
          ))}
        </div>
      )}

      {/* Email Modal (when email not known) */}
      <Modal
        isOpen={!!sendModal}
        onClose={() => setSendModal(null)}
        title={`Envoyer via ${sendModal?.brand} — ${sendModal?.event.booking?.customerName || sendModal?.event.clientName}`}
      >
        {sendModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Le client recevra un lien unique vers sa page de satisfaction et d'accès à ses photos.
            </p>

            <div>
              <label className="label">Email du client *</label>
              <Input
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="client@email.com"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(sendModal.event, sendModal.brand, sendEmail); }}
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setSendModal(null)}>Annuler</Button>
              <Button
                onClick={() => handleSend(sendModal.event, sendModal.brand, sendEmail)}
                disabled={sending}
                className={sendModal.brand === 'SMAKK' ? '!bg-purple-600 hover:!bg-purple-700' : '!bg-orange-500 hover:!bg-orange-600'}
              >
                <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                {sending ? 'Envoi...' : `Envoyer via ${sendModal.brand}`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EventCard({ event, onRename, onBrandSend, onCopyLink, sending }: {
  event: CalendarEvent;
  onRename: (newName: string) => void;
  onBrandSend: (brand: 'SHOOTNBOX' | 'SMAKK') => void;
  onCopyLink: () => void;
  sending: boolean;
}) {
  const booking = event.booking;
  const showStatus = booking && booking.status !== 'link_sent';
  const statusInfo = showStatus ? STATUS_LABELS[booking.status] || { label: booking.status, color: 'bg-gray-100 text-gray-600' } : null;

  const displayName = booking?.customerName || event.clientName;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);

  const handleSaveRename = () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === displayName) {
      setEditing(false);
      setEditName(displayName);
      return;
    }
    onRename(trimmed);
    setEditing(false);
  };

  const handleCancelRename = () => {
    setEditing(false);
    setEditName(displayName);
  };

  return (
    <Card className="p-4 flex flex-col justify-between">
      {/* Top: date + type de borne */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1 text-sm text-gray-500">
            <CalendarDaysIcon className="h-4 w-4" />
            {formatDateRange(event.startDate, event.endDate)}
          </span>
          {statusInfo && (
            <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap', statusInfo.color)}>
              {statusInfo.label}
            </span>
          )}
        </div>

        {/* Client Name - editable */}
        <div className="flex items-center gap-1.5 mb-2">
          {editing ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') handleCancelRename(); }}
                className="flex-1 border border-primary-300 rounded px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
              <button onClick={handleSaveRename} className="p-1 text-green-600 hover:text-green-700">
                <CheckIcon className="h-4 w-4" />
              </button>
              <button onClick={handleCancelRename} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-gray-900 truncate">{displayName}</h3>
              {booking && (
                <button
                  onClick={() => { setEditName(displayName); setEditing(true); }}
                  className="p-0.5 text-gray-400 hover:text-primary-600 flex-shrink-0"
                  title="Modifier le nom du client"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Type de borne */}
        {event.produitNom && (
          <div className="mb-3">
            <Badge variant="default" size="sm">{event.produitNom}</Badge>
          </div>
        )}

        {/* Booking info */}
        {booking && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400 mb-3">
            {booking.senderBrand && (
              <span className={clsx('px-1.5 py-0.5 rounded text-xs font-bold',
                booking.senderBrand === 'SHOOTNBOX' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
              )}>
                {booking.senderBrand}
              </span>
            )}
            {booking.galleryUrl && (
              <a href={booking.galleryUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-green-600 hover:underline">
                <FolderOpenIcon className="h-3 w-3" />
                Drive
              </a>
            )}
            {booking.emailSentAt && (
              <span className="flex items-center gap-1">
                <CheckCircleIcon className="h-3 w-3 text-green-500" />
                Envoyé {new Date(booking.emailSentAt).toLocaleDateString('fr-FR')}
              </span>
            )}
            {booking._count.events > 0 && (
              <span className="flex items-center gap-1">
                <EyeIcon className="h-3 w-3" />
                {booking._count.events} visite{booking._count.events > 1 ? 's' : ''}
              </span>
            )}
            {booking._count.reviewMatches > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <StarIcon className="h-3 w-3" />
                {booking._count.reviewMatches} avis
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom: Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        {booking?.galleryUrl && (
          <Button variant="outline" size="sm" onClick={async () => {
            try {
              await navigator.clipboard.writeText(booking.galleryUrl!);
              toast.success('Lien Drive copié !');
            } catch { toast.error('Impossible de copier'); }
          }} title="Copier le lien Google Drive" className="flex-shrink-0">
            <FolderOpenIcon className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onCopyLink} title="Copier le lien client" className="flex-shrink-0">
          {booking ? <ClipboardDocumentIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
        </Button>
        <button
          onClick={() => onBrandSend('SHOOTNBOX')}
          disabled={sending}
          className="flex-1 py-1.5 px-3 rounded-lg border-2 border-orange-400 bg-orange-50 text-orange-700 text-xs font-bold hover:bg-orange-100 transition-all disabled:opacity-50"
          title="Envoyer via SHOOTNBOX"
        >
          SHOOTNBOX
        </button>
        <button
          onClick={() => onBrandSend('SMAKK')}
          disabled={sending}
          className="flex-1 py-1.5 px-3 rounded-lg border-2 border-purple-400 bg-purple-50 text-purple-700 text-xs font-bold hover:bg-purple-100 transition-all disabled:opacity-50"
          title="Envoyer via SMAKK"
        >
          SMAKK
        </button>
      </div>
    </Card>
  );
}
